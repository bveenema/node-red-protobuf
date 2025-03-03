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
                protoFileNode.protoTypes = new Root().loadSync(protoFileNode.protopath, { keepCase: protoFileNode.keepCase });
                
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
                // if it's an array, just watch the first one, it's most likely the one likely to change.
                // As the subsequent files are more likely dependencies on the root.
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
