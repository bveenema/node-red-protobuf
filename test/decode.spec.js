var should = require('should');
var helper = require('node-red-node-test-helper');
var decode = require('../src/nodes/decode');
var protofile = require('../src/nodes/protofile');
var encode = require('../src/nodes/encode');

helper.init(require.resolve('node-red'));

// Setup integrated flow for testing - encode a message then decode it
var decodeFlow = [
  {
    'id': 'encode-node',
    'type': 'pb_encode',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'protofile': 'c55e9eb5.3175',
    'protoType': 'TestType',
    'wires': [
      [
        'decode-node'
      ]
    ]
  },
  {
    'id': 'decode-node',
    'type': 'pb_decode',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'protofile': 'c55e9eb5.3175',
    'protoType': 'TestType', // Using node-defined type
    'wires': [
      [
        'helper-node'
      ]
    ]
  },
  {
    'id': 'helper-node',
    'type': 'helper',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'outputs': 1,
    'noerr': 0,
    'wires': [
      []
    ]
  },
  {
    'id': 'c55e9eb5.3175',
    'type': 'protobuf_file',
    'z': '',
    'protopath': 'test/assets/test.proto'
  }
];

// Flow with empty protoType in decode node to test msg.protobufType usage
var decodeFlowEmptyType = [
  {
    'id': 'encode-node',
    'type': 'pb_encode',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'protofile': 'c55e9eb5.3175',
    'protoType': 'TestType',
    'wires': [
      [
        'decode-node'
      ]
    ]
  },
  {
    'id': 'decode-node',
    'type': 'pb_decode',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'protofile': 'c55e9eb5.3175',
    'protoType': '', // Empty to force using msg.protobufType
    'wires': [
      [
        'helper-node'
      ]
    ]
  },
  {
    'id': 'helper-node',
    'type': 'helper',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'outputs': 1,
    'noerr': 0,
    'wires': [
      []
    ]
  },
  {
    'id': 'c55e9eb5.3175',
    'type': 'protobuf_file',
    'z': '',
    'protopath': 'test/assets/test.proto'
  }
];

// Sample test message
const testMessage = {
  timestamp: 1533295590569,
  foo: 1.0,
  bar: true,
  test: 'A string value'
};

describe('protobuf decode node', function () {

  afterEach(function () {
    helper.unload();
    should();
  });

  it('should be loaded', function (done) {
    var flow = [{ id: 'n1', type: 'pb_decode', name: 'test name' }];
    helper.load(decode, flow, function () {
      var n1 = helper.getNode('n1');
      n1.should.have.property('name', 'test name');
      done();
    });
  });

  it('should use node.protoType and ignore msg.protobufType when node type is set', function (done) {
    // This test verifies that when a specific protobuf type is selected in the node's dropdown,
    // any msg.protobufType provided in the incoming message will be ignored
    helper.load([encode, decode, protofile], decodeFlow, function () {
      var encodeNode = helper.getNode('encode-node');
      var helperNode = helper.getNode('helper-node');
      
      helperNode.on('input', function (msg) {
        // The message should be decoded using the node's type (TestType)
        msg.payload.should.have.property('timestamp', testMessage.timestamp);
        msg.payload.should.have.property('foo', testMessage.foo);
        msg.payload.should.have.property('bar', testMessage.bar);
        msg.payload.should.have.property('test', testMessage.test);
        
        // Even though msg.protobufType might contain 'DifferentType' from the encode node,
        // the decode node should use its configured type ('TestType') instead
        msg.protobufType.should.equal('TestType');
        done();
      });
      
      // Send a message with a different protobufType that should be ignored by the decode node
      encodeNode.receive({
        payload: testMessage,
        protobufType: 'DifferentType' // This will be used by encode but ignored by decode
      });
    });
  });

  it('should use msg.protobufType when node.protoType is empty', function (done) {
    // This test verifies that when "Use msg.protobufType" is selected in the node's dropdown,
    // the msg.protobufType value from the incoming message will be used
    helper.load([encode, decode, protofile], decodeFlowEmptyType, function () {
      var encodeNode = helper.getNode('encode-node');
      var helperNode = helper.getNode('helper-node');
      
      helperNode.on('input', function (msg) {
        // The message should be decoded using msg.protobufType (TestType)
        msg.payload.should.have.property('timestamp', testMessage.timestamp);
        msg.payload.should.have.property('foo', testMessage.foo);
        msg.payload.should.have.property('bar', testMessage.bar);
        msg.payload.should.have.property('test', testMessage.test);
        
        // Since node.protoType in the decode node is empty (simulating "Use msg.protobufType" selected),
        // the node should use the protobufType from the message set by the encode node
        msg.protobufType.should.equal('TestType');
        done();
      });
      
      // The encode node will set protobufType to TestType in the output message,
      // which should then be used by the decode node
      encodeNode.receive({
        payload: testMessage
      });
    });
  });

});
