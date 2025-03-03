module.exports = function (RED) {
    function ProtobufEncodeNode (config) {
        RED.nodes.createNode(this, config);
        // Retrieve the config node
        this.protofile = RED.nodes.getNode(config.protofile);
        this.protoType = config.protoType;
        var node = this;
        node.on('input', function (msg) {
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
                return node.status({fill: 'yellow', shape: 'dot', text: 'Message type not found'});
            }
            // create a protobuf message and convert it into a buffer
            const message = config.flexibleInput
                ? messageType.fromObject(msg.payload)
                : messageType.create(msg.payload);
            
            if (messageType.verify(message)) {
                node.warn('Message is not valid under selected message type.');
                return node.status({fill: 'yellow', shape: 'dot', text: 'Message invalid'});
            }

            msg.payload = (
              config.messageDelimited
                ? messageType.encodeDelimited(message)
                : messageType.encode(message)
            ).finish();
            // convert the buffer to a string of hex values
            msg.protobufString = Array.from(msg.payload).map(b => b.toString(16).padStart(2, '0')).join('');
            // Set protobufType in the message to the type that was actually used
            msg.protobufType = useType;
            node.status({fill: 'green', shape: 'dot', text: 'Processed'});
            node.send(msg);
        });
    }
    RED.nodes.registerType('pb_encode', ProtobufEncodeNode);
};
