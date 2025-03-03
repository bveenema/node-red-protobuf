const protobufjs = require('protobufjs');
const Long = protobufjs.util.Long;

module.exports = function(RED) {
    function ProtobufDecodeNode(config) {
        RED.nodes.createNode(this, config);
        // Retrieve the config node
        this.protofile = RED.nodes.getNode(config.protofile);
        this.protoType = config.protoType;
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
                        // Reconstruct the length from varint encoding
                        let length = node.lengthBytes.reduce((acc, byte) => {
                            return (acc << 7) | (byte & 0x7F);
                        }, 0);
                        
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

        // Move final message processing to a helper function
        let processDecodedMessage = function(messageType, decodedResult, msg) {
            if (decodedResult.error) {
                if (decodedResult.error === 'incomplete') {
                    msg.payload = decodedResult.instance;
                    node.send(msg);
                }
                return false;
            }

            msg.payload = messageType.toObject(decodedResult.message, getDecodeOptions());
            node.status({fill: 'green', shape: 'dot', text: 'Processed'});
            node.send(msg);
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
    
    // Export ProtobufDecodeNode for testing purposes
    module.exports.ProtobufDecodeNode = ProtobufDecodeNode;
};
