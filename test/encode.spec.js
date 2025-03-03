var should = require('should');
var helper = require('node-red-node-test-helper');
var encode = require('../src/nodes/encode');
var protofile = require('../src/nodes/protofile');

helper.init(require.resolve('node-red'));

var encodeFlow = [{
    'id': 'encode-node',
    'type': 'pb_encode',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'protofile': 'c55e9eb5.3175',
    'protoType': 'TestType',
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

var encodeFlowEmptyType = [{
    'id': 'encode-node',
    'type': 'pb_encode',
    'z': 'e4c459b3.cc22e8',
    'name': '',
    'protofile': 'c55e9eb5.3175',
    'protoType': '',
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

const testMessage = {
  timestamp: 1533295590569,
  foo: 1.0,
  bar: true,
  test: 'A string value'
};

describe('protobuf encode node', function () {

  afterEach(function () {
    helper.unload();
    should();
  });

  it('should be loaded', function (done) {
    var flow = [{
      id: 'n1',
      type: 'pb_encode',
      name: 'test name',
      protoType: 'TestType'
    }];
    helper.load(encode, flow, function () {
      var n1 = helper.getNode('n1');
      n1.should.have.property('name', 'test name');
      n1.should.have.property('protoType', 'TestType');
      done();
    });
  });

  it('should encode a message into a buffer', function (done) {
    helper.load([encode, protofile], encodeFlow, function () {
      var encodeNode = helper.getNode('encode-node');
      var helperNode = helper.getNode('helper-node');
      helperNode.on('input', function (msg) {
        should(msg.payload instanceof Buffer).equal(true);
        msg.protobufType.should.equal('TestType');
        done();
      });
      encodeNode.receive({
        payload: testMessage
      });
    });
  });

  it('should use msg.protobufType when node.protoType is empty', function (done) {
    // This test verifies that when "Use msg.protobufType" is selected in the node's dropdown,
    // the msg.protobufType value from the incoming message will be used
    helper.load([encode, protofile], encodeFlowEmptyType, function () {
      var encodeNode = helper.getNode('encode-node');
      var helperNode = helper.getNode('helper-node');
      helperNode.on('input', function (msg) {
        should(msg.payload instanceof Buffer).equal(true);
        // Since node.protoType is empty (simulating "Use msg.protobufType" selected),
        // the node should use the protobufType from the message
        msg.protobufType.should.equal('TestType');
        done();
      });
      encodeNode.receive({
        payload: testMessage,
        protobufType: 'TestType' // This should be used because node.protoType is empty
      });
    });
  });

  it('should ignore msg.protobufType when node.protoType is set', function (done) {
    // This test verifies that when a specific protobuf type is selected in the node's dropdown,
    // any msg.protobufType provided in the incoming message will be ignored
    helper.load([encode, protofile], encodeFlow, function () {
      var encodeNode = helper.getNode('encode-node');
      var helperNode = helper.getNode('helper-node');
      helperNode.on('input', function (msg) {
        should(msg.payload instanceof Buffer).equal(true);
        // Even though we send a message with protobufType='DifferentType',
        // the node should use its configured type ('TestType') instead
        msg.protobufType.should.equal('TestType');
        done();
      });
      encodeNode.receive({
        payload: testMessage,
        protobufType: 'DifferentType' // This should be ignored
      });
    });
  });

});
