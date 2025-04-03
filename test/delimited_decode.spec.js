const should = require('should');
const helper = require('node-red-node-test-helper');
const decode = require('../src/nodes/decode');
const protofile = require('../src/nodes/protofile');
const protobufjs = require('protobufjs');
const fs = require('fs');
const path = require('path');

helper.init(require.resolve('node-red'));

// Extract the ProtobufDecodeNode class for direct testing
const ProtobufDecodeNode = decode.ProtobufDecodeNode;

describe('Protobuf varint decode tests', function() {
    
    afterEach(function(done) {
        helper.unload();
        done();
    });

    // Test single-byte varint (0-127)
    it('should correctly decode messages with single-byte varint length', function(done) {
        // Create a test flow with decode and helper node
        const flow = [
            {
                id: 'decode-node',
                type: 'pb_decode',
                name: 'decode test',
                protofile: 'proto-file-node',
                protoType: 'TestType',
                messageDelimited: true,
                wires: [['helper-node']]
            },
            {
                id: 'helper-node',
                type: 'helper'
            },
            {
                id: 'proto-file-node',
                type: 'protobuf_file',
                protopath: 'test/assets/test.proto'
            }
        ];

        // Load the proto file directly
        const protoContents = fs.readFileSync(path.join(__dirname, 'assets/test.proto'), 'utf8');
        const root = protobufjs.parse(protoContents).root;
        const TestType = root.lookupType('TestType');
        
        // Create a small message that will result in a single-byte varint length
        const smallMessage = {
            timestamp: 123,
            foo: 1.0,
            bar: true,
            test: 'Small test'
        };
        
        // Encode the message with delimited format
        const message = TestType.create(smallMessage);
        const encodedBuffer = TestType.encodeDelimited(message).finish();
        
        // Verify the first byte (length varint) has MSB=0 (single byte)
        (encodedBuffer[0] & 0x80).should.equal(0);

        helper.load([decode, protofile], flow, function() {
            const decodeNode = helper.getNode('decode-node');
            const helperNode = helper.getNode('helper-node');
            
            helperNode.on('input', function(msg) {
                try {
                    // The message was successfully decoded
                    msg.should.have.property('payload');
                    
                    // Verify all fields were correctly decoded
                    msg.payload.should.have.property('timestamp', smallMessage.timestamp);
                    msg.payload.should.have.property('foo', smallMessage.foo);
                    msg.payload.should.have.property('bar', smallMessage.bar);
                    msg.payload.should.have.property('test', smallMessage.test);
                    
                    done();
                } catch (err) {
                    done(err);
                }
            });
            
            // Send the test message to the decode node
            decodeNode.receive({
                payload: encodedBuffer
            });
        });
    });

    // Test multi-byte varint (>127)
    it('should correctly decode messages with multi-byte varint length', function(done) {
        // Create a test flow with decode and helper node
        const flow = [
            {
                id: 'decode-node',
                type: 'pb_decode',
                name: 'decode test',
                protofile: 'proto-file-node',
                protoType: 'TestType',
                messageDelimited: true,
                wires: [['helper-node']]
            },
            {
                id: 'helper-node',
                type: 'helper'
            },
            {
                id: 'proto-file-node',
                type: 'protobuf_file',
                protopath: 'test/assets/test.proto'
            }
        ];

        // Load the proto file directly
        const protoContents = fs.readFileSync(path.join(__dirname, 'assets/test.proto'), 'utf8');
        const root = protobufjs.parse(protoContents).root;
        const TestType = root.lookupType('TestType');
        
        // Create a large message that will result in a multi-byte varint length
        const largeMessage = {
            timestamp: 1234567890.123,
            foo: 123.456,
            bar: true,
            test: 'A'.repeat(200) // Use a long string to make the message large
        };
        
        // Encode the message with delimited format
        const message = TestType.create(largeMessage);
        const encodedBuffer = TestType.encodeDelimited(message).finish();
        
        // Verify the first byte (length varint) has MSB=1 (multi-byte)
        (encodedBuffer[0] & 0x80).should.equal(0x80);

        helper.load([decode, protofile], flow, function() {
            const decodeNode = helper.getNode('decode-node');
            const helperNode = helper.getNode('helper-node');
            
            helperNode.on('input', function(msg) {
                try {
                    // The message was successfully decoded
                    msg.should.have.property('payload');
                    
                    // Verify all fields were correctly decoded
                    msg.payload.should.have.property('timestamp', largeMessage.timestamp);
                    // Account for floating-point precision issues
                    msg.payload.should.have.property('foo');
                    Math.abs(msg.payload.foo - largeMessage.foo).should.be.lessThan(0.001);
                    msg.payload.should.have.property('bar', largeMessage.bar);
                    msg.payload.should.have.property('test', largeMessage.test);
                    
                    done();
                } catch (err) {
                    done(err);
                }
            });
            
            // Send the test message to the decode node
            decodeNode.receive({
                payload: encodedBuffer
            });
        });
    });
}); 