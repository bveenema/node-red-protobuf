const { Root } = require('protobufjs');
const protobufjs = require('protobufjs');
const fs = require('fs');
const path = require('path');

module.exports = function (RED) {
    // API endpoint for browsing directories
    RED.httpAdmin.get('/protobuf-browser/*', RED.auth.needsPermission('protobuf_file.read'), function(req, res) {
        const requestedPath = req.params[0] || '/';
        let absolutePath;
        
        try {
            // Handle empty path or root
            if (!requestedPath || requestedPath === '/') {
                // On Windows, list drives; on Unix, start at root
                if (process.platform === 'win32') {
                    // List Windows drives
                    const { execSync } = require('child_process');
                    const drives = execSync('wmic logicaldisk get name').toString()
                        .split('\n')
                        .filter(line => /[A-Za-z]:/.test(line))
                        .map(drive => drive.trim());
                    
                    return res.json({
                        path: '/',
                        items: drives.map(drive => ({
                            name: drive,
                            path: drive,
                            isDirectory: true,
                            isFile: false
                        }))
                    });
                } else {
                    absolutePath = '/';
                }
            } else {
                // For non-root paths
                absolutePath = requestedPath;
            }
            
            // Read directory contents
            fs.readdir(absolutePath, { withFileTypes: true }, (err, dirents) => {
                if (err) {
                    res.status(500).send({ error: 'Error reading directory: ' + err.message });
                    return;
                }
                
                const items = dirents.map(dirent => ({
                    name: dirent.name,
                    path: path.join(requestedPath, dirent.name).replace(/\\/g, '/'),
                    isDirectory: dirent.isDirectory(),
                    isFile: dirent.isFile(),
                    isProto: dirent.isFile() && dirent.name.endsWith('.proto')
                }));
                
                // Sort: directories first, then files
                items.sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                });
                
                res.json({ path: requestedPath, items: items });
            });
        } catch (error) {
            res.status(500).send({ error: 'Server error: ' + error.message });
        }
    });

    // API endpoint to get protobuf types from a file node
    RED.httpAdmin.get('/protobuf-types/:id', RED.auth.needsPermission('protobuf_file.read'), function(req, res) {
        const nodeId = req.params.id;
        const node = RED.nodes.getNode(nodeId);
        
        if (node && node.protoTypes) {
            try {
                // Extract the types from the loaded protobuf file
                const types = getAllTypes(node.protoTypes);
                res.json({ types: types });
            } catch (error) {
                res.status(500).send({ error: 'Error extracting types: ' + error.message });
            }
        } else {
            res.status(404).send({ error: 'Node not found or proto file not loaded' });
        }
    });
    
    // New API endpoint to get a specific type definition
    RED.httpAdmin.get('/protobuf-type-definition/:id/:type', RED.auth.needsPermission('protobuf_file.read'), function(req, res) {
        const nodeId = req.params.id;
        const typeName = req.params.type;
        const node = RED.nodes.getNode(nodeId);
        
        if (!node || !node.protoTypes) {
            return res.status(404).send({ error: 'Node not found or proto file not loaded' });
        }
        
        try {
            // Find the requested type in the proto definition
            let typeObj;
            try {
                typeObj = node.protoTypes.lookupType(typeName);
            } catch (e) {
                return res.status(404).send({ error: 'Type not found: ' + typeName });
            }
            
            if (!typeObj) {
                return res.status(404).send({ error: 'Type not found: ' + typeName });
            }
            
            // Generate a pretty-printed representation of the type structure
            const definition = formatTypeDefinition(typeObj);
            
            res.json({ definition: definition });
        } catch (error) {
            res.status(500).send({ error: 'Error getting type definition: ' + error.message });
        }
    });
    
    // Helper function to format a type definition for display
    function formatTypeDefinition(typeObj) {
        let result = `message ${typeObj.name} {\n`;
        
        // Format fields
        Object.entries(typeObj.fields).forEach(([fieldName, field]) => {
            // Handle field type (could be a primitive or another message)
            let fieldType = field.type;
            if (field.resolvedType) {
                fieldType = field.resolvedType.fullName;
            }
            
            // Handle repeated fields
            const repeated = field.repeated ? 'repeated ' : '';
            
            // Handle field rule
            const rule = field.rule ? field.rule + ' ' : '';
            
            // Add indentation and field definition
            result += `  ${rule}${repeated}${fieldType} ${fieldName} = ${field.id};\n`;
        });
        
        // Handle nested types
        if (typeObj.nested) {
            Object.entries(typeObj.nested).forEach(([nestedName, nestedType]) => {
                if (nestedType.fields) {  // It's a message
                    const nestedDefinition = formatTypeDefinition(nestedType)
                        .split('\n')
                        .map(line => `  ${line}`)  // Add extra indentation
                        .join('\n');
                    result += `\n${nestedDefinition}\n`;
                } else if (nestedType.values) {  // It's an enum
                    result += `\n  enum ${nestedName} {\n`;
                    Object.entries(nestedType.values).forEach(([enumName, enumValue]) => {
                        result += `    ${enumName} = ${enumValue};\n`;
                    });
                    result += `  }\n`;
                }
            });
        }
        
        result += '}';
        return result;
    }
    
    // Helper function to get all message types from a protobuf root
    function getAllTypes(root, prefix = '') {
        let types = [];
        
        if (!root || !root.nested) return types;
        
        // Iterate through all nested namespaces and types
        Object.keys(root.nested).forEach(key => {
            const elem = root.nested[key];
            const fullName = prefix ? `${prefix}.${key}` : key;
            
            if (elem.fields) {
                // This is a message type
                types.push(fullName);
            }
            
            if (elem.nested) {
                // This is a namespace, recursively get types
                types = types.concat(getAllTypes(elem, fullName));
            }
        });
        
        return types;
    }

    function ProtoFileNode(config) {
        RED.nodes.createNode(this, config);
        
        if (config.protopath.includes(",")) {
            this.protopath = config.protopath.split(",");
        } else {
            this.protopath = config.protopath;
        }
        this.watchFile = config.watchFile;
        this.keepCase = config.keepCase;
        this.types = []; // Store the list of available message types
        
        const protoFileNode = this;
        
        protoFileNode.load = function () {
            try {
                // Create a new Root instance
                protoFileNode.protoTypes = new Root();
                
                // If protopath is an array, load each file individually
                if (Array.isArray(protoFileNode.protopath)) {
                    // Load each proto file into the same root
                    protoFileNode.protopath.forEach(path => {
                        if (path.trim()) { // Skip empty paths
                            protoFileNode.protoTypes.loadSync(path, { keepCase: protoFileNode.keepCase });
                        }
                    });
                } else {
                    // Load a single file
                    protoFileNode.protoTypes.loadSync(protoFileNode.protopath, { keepCase: protoFileNode.keepCase });
                }
                
                // Extract and store all message types
                protoFileNode.types = getAllTypes(protoFileNode.protoTypes);
            }
            catch (error) {
                protoFileNode.error('Proto file could not be loaded. ' + error);
                protoFileNode.types = [];
            }
        };
        
        protoFileNode.watchFile = function () {
            try {
                // When multiple proto files are specified (as an array),
                // we only watch the first file for changes to avoid excessive file watchers.
                // The first file is typically the main proto file, with others being dependencies.
                let watchedFile = protoFileNode.protopath;
                if (Array.isArray(watchedFile)) {
                    watchedFile = watchedFile[0];
                }
                protoFileNode.protoFileWatcher = fs.watch(watchedFile, (eventType) => {
                    if (eventType === 'change') {
                        protoFileNode.load();
                        protoFileNode.log('Protobuf file changed on disk. Reloaded.');
                    }
                });
                protoFileNode.on('close', () => {
                    protoFileNode.protoFileWatcher.close();
                });
            }
            catch (error) {
                protoFileNode.error('Error when trying to watch the file on disk: ' + error);
            }
        };
        
        protoFileNode.load();
        if (protoFileNode.protoTypes !== undefined && protoFileNode.watchFile) protoFileNode.watchFile();
    }
    
    RED.nodes.registerType('protobuf_file', ProtoFileNode);
};
