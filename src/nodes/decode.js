const protobufjs = require('protobufjs');
const Long = protobufjs.util.Long;

module.exports = function(RED) {
    function ProtobufDecodeNode(config) {
        RED.nodes.createNode(this, config);
        // Retrieve the config node
        this.protofile = RED.nodes.getNode(config.protofile);
        this.protoType = config.protoType;
        this.splitOutput = config.splitOutput;
        this.outputs = config.outputs || 1; // Use the stored outputs value
        var node = this;

        // Add stream handling state
        this.messageBytes = [];
        this.lengthBytes = [];
        this.expectedLength = null;

        // Add timeout handle
        this.streamTimeout = null;
        this.streamTimeoutDuration = config.streamTimeout || 100; // Use configured value or default to 100ms

        let resolveMessageType = function (msg) {
            // Only use msg.protobufType when node.protoType is empty
            const useType = node.protoType || msg.protobufType;
            
            if (useType === undefined) {
                node.error('No protobuf type supplied!');
                return node.status({fill: 'red', shape: 'dot', text: 'Protobuf type missing'});
            }
            if (node.protofile.protoTypes === undefined) {
                node.error('No .proto types loaded! Check that the file exists and that node-red has permission to access it.');
                return node.status({fill: 'red', shape: 'dot', text: 'Protofile not ready'});
            }
            node.status({fill: 'green', shape: 'dot', text: 'Ready'});
            let messageType;
            try {
                messageType = node.protofile.protoTypes.lookupType(useType);
                // Set protobufType in the message to the type that was actually used
                msg.protobufType = useType;
                return messageType;
            }
            catch (error) {
                node.warn(`
                    Problem while looking up the message type.
                    ${error}
                    Protofile object:
                    ${node.protofile.protopath}
                    Prototypes content:
                    ${JSON.stringify(node.protofile.protoTypes)}
                    With configured protoType:
                    ${useType}
                `);
                node.status({fill: 'yellow', shape: 'dot', text: 'Message type not found'});
                return null;
            }
        };

        let createMessageObject = function(completeMessage, lengthBytes = null) {
            return {
                payload: config.messageDelimited && lengthBytes ? 
                    Buffer.concat([Buffer.from(lengthBytes), completeMessage]) : 
                    completeMessage,
                proto: {
                    msg: completeMessage.toString('hex'),
                    ...(lengthBytes && { msgDelimited: Buffer.from(lengthBytes).toString('hex') + completeMessage.toString('hex') }),
                    length: completeMessage.length
                }
            };
        };

        let resetMessageState = function() {
            node.messageBytes = [];
            node.lengthBytes = [];
            node.expectedLength = null;
        };

        let processCompleteMessage = function(completeMessage, lengthBytes = null) {
            let msg = createMessageObject(completeMessage, lengthBytes);
            
            let messageType = resolveMessageType(msg);
            if (!messageType) return;
            
            let decodedResult = decodeMessage(messageType, msg.payload, config.messageDelimited);
            processDecodedMessage(messageType, decodedResult, msg);
            
            resetMessageState();
        };

        let processStreamByte = function(byte) {
            // Clear any existing timeout
            if (node.streamTimeout) {
                clearTimeout(node.streamTimeout);
                node.streamTimeout = null;
            }

            if (config.messageDelimited) {
                // If we don't have the full length yet
                if (node.expectedLength === null) {
                    node.lengthBytes.push(byte);
                    
                    // Check if this is the last length byte (MSB is 0)
                    if ((byte & 0x80) === 0) {
                        // Reconstruct the length from varint encoding (little-endian)
                        let length = 0;
                        for (let i = 0; i < node.lengthBytes.length; i++) {
                            length |= (node.lengthBytes[i] & 0x7F) << (i * 7);
                        }
                        
                        if (length > 0) {
                            node.expectedLength = length;
                        } else {
                            resetMessageState();
                        }
                    }
                    return null;
                }
                
                // Collecting message bytes
                node.messageBytes.push(byte);
                
                // Check if we have a complete message
                if (node.messageBytes.length === node.expectedLength) {
                    let completeMessage = Buffer.from(node.messageBytes);
                    let lengthBytes = [...node.lengthBytes];  // Save for debug info
                    // Instead of processing here, return the message object to be processed by input handler
                    let result = createMessageObject(completeMessage, lengthBytes);
                    resetMessageState();
                    return result;
                }
            } else {
                // Non-delimited message handling
                node.messageBytes.push(byte);
                
                // Set timeout to process message if no more bytes arrive
                node.streamTimeout = setTimeout(() => {
                    let completeMessage = Buffer.from(node.messageBytes);
                    processCompleteMessage(completeMessage);
                }, node.streamTimeoutDuration);
            }
            
            node.status({fill: 'blue', shape: 'dot', text: `Collecting bytes: ${node.messageBytes.length}`});
            return null;
        };

        // Move decode options setup to a helper function
        let getDecodeOptions = function() {
            return {
                longs: config.decodeLongs === "String" ? String :
                       config.decodeLongs === "Number" ? Number : 
                       config.decodeLongs === "Long" ? Long : String,
                enums: config.decodeEnums === "String" ? String :
                       config.decodeEnums === "Number" ? Number : String,
                bytes: config.decodeBytes === "String" ? String :
                       config.decodeBytes === "Array" ? Array :
                       config.decodeBytes === "Buffer" ? Buffer : String,
                defaults: config.decodeDefaults,
                arrays: config.decodeArrays,
                objects: config.decodeObjects,
                oneofs: config.decodeOneofs,
                json: config.decodeJson
            };
        };

        // Move message decoding logic to a helper function
        let decodeMessage = function(messageType, payload, isDelimited) {
            let message;
            try {
                message = isDelimited ? messageType.decodeDelimited(payload) : messageType.decode(payload);
            }
            catch (exception) {
                if (exception instanceof protobufjs.util.ProtocolError) {
                    node.warn('Received message contains empty fields. Incomplete message will be forwarded.');
                    node.status({fill: 'yellow', shape: 'dot', text: 'Message incomplete'});
                    return { error: 'incomplete', instance: exception.instance };
                }
                else {
                    node.warn(`Wire format is invalid: ${exception}`);
                    node.status({fill: 'yellow', shape: 'dot', text: 'Wire format invalid'});
                    return { error: 'invalid' };
                }
            }
            return { message };
        };

        // Process the decoded message and send it to the appropriate outputs
        let processDecodedMessage = function(messageType, decodedResult, msg) {
            if (decodedResult.error) {
                if (decodedResult.error === 'incomplete') {
                    msg.payload = decodedResult.instance;
                    node.send(msg);
                }
                return false;
            }

            const decodedObject = messageType.toObject(decodedResult.message, getDecodeOptions());
            
            if (node.splitOutput && messageType && messageType.fieldsArray) {
                // Split output mode - create a message for each field in the correct order
                const fields = messageType.fieldsArray;
                
                // Sort fields by their field number
                fields.sort((a, b) => a.id - b.id);
                
                // Create an array of null values with the correct length (based on configured outputs)
                const outputs = new Array(parseInt(node.outputs) || 1).fill(null);
                
                // Create a message for each field
                fields.forEach((field, index) => {
                    // Only process if within the outputs array bounds
                    if (index < outputs.length && decodedObject.hasOwnProperty(field.name)) {
                        const fieldMsg = RED.util.cloneMessage(msg);
                        fieldMsg.payload = decodedObject[field.name];
                        fieldMsg.field = field.name;
                        fieldMsg.fieldType = field.type;
                        outputs[index] = fieldMsg;
                    }
                });
                
                node.status({fill: 'green', shape: 'dot', text: 'Split output'});
                node.send(outputs);
            } else {
                // Standard mode - send the full decoded object
                msg.payload = decodedObject;
                node.status({fill: 'green', shape: 'dot', text: 'Processed'});
                node.send(msg);
            }
            return true;
        };

        node.on('input', function(msg) {
            if (config.streamInput) {
                // Handle stream input - expect single byte
                if (!Buffer.isBuffer(msg.payload) || msg.payload.length !== 1) {
                    node.error('Stream input mode expects single byte buffers');
                    return node.status({fill: 'red', shape: 'dot', text: 'Invalid stream input'});
                }

                let result = processStreamByte(msg.payload[0]);
                if (result) {
                    // We have a complete message to decode
                    msg.payload = result.payload;

                    let messageType = resolveMessageType(msg);
                    if (!messageType) return;
                    
                    let decodedResult = decodeMessage(messageType, msg.payload, config.messageDelimited);
                    processDecodedMessage(messageType, decodedResult, msg);
                } else {
                    // Still collecting bytes
                    node.status({fill: 'blue', shape: 'dot', text: `Collecting bytes: ${node.messageBytes.length}`});
                }
            } else {
                // Handle normal input
                let messageType = resolveMessageType(msg);
                if (!messageType) return;
                
                let decodedResult = decodeMessage(messageType, msg.payload, config.messageDelimited);
                processDecodedMessage(messageType, decodedResult, msg);
            }
        });

        // Clean up state when node is closed
        node.on('close', function() {
            if (node.streamTimeout) {
                clearTimeout(node.streamTimeout);
                node.streamTimeout = null;
            }
            node.messageBytes = [];
            node.lengthBytes = [];
            node.expectedLength = null;
        });
    }

    RED.nodes.registerType('pb_decode', ProtobufDecodeNode);
    
    // Add a new API endpoint to fetch the fields of a protobuf type
    RED.httpAdmin.get('/protobuf-type-fields/:id/:type', function(req, res) {
        try {
            const node = RED.nodes.getNode(req.params.id);
            if (!node) {
                console.log("Node not found:", req.params.id);
                return res.status(404).json({ error: "Node not found", fields: [] });
            }
            
            // Access the protoTypes from the node
            if (!node.protoTypes) {
                console.log("protoTypes not found in node");
                // For protobuf_file nodes, the protoTypes should be directly on the node
                if (node.type === "protobuf_file") {
                    if (node.protoTypes) {
                        return lookupType(node.protoTypes);
                    }
                }
                return res.status(404).json({ error: "Proto types not found", fields: [] });
            }
            
            return lookupType(node.protoTypes);
            
            function lookupType(protoTypes) {
                try {
                    const messageType = protoTypes.lookupType(req.params.type);
                    if (!messageType || !messageType.fieldsArray) {
                        return res.json({ fields: [] });
                    }
                    
                    const fields = messageType.fieldsArray.map(field => ({
                        name: field.name,
                        type: field.type,
                        id: field.id
                    }));
                    
                    // Sort fields by their field number
                    fields.sort((a, b) => a.id - b.id);
                    return res.json({ fields: fields });
                } catch (err) {
                    console.log("Error looking up type:", err.message);
                    return res.json({ error: err.toString(), fields: [] });
                }
            }
        } catch (err) {
            console.log("Error in API endpoint:", err.message);
            res.status(500).json({ error: err.toString(), fields: [] });
        }
    });
    
    // Export ProtobufDecodeNode for testing purposes
    module.exports.ProtobufDecodeNode = ProtobufDecodeNode;
};
