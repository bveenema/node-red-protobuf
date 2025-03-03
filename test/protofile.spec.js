var should = require('should');
var helper = require('node-red-node-test-helper');
var protofile = require('../src/nodes/protofile');
var fs = require('fs');
var path = require('path');
const { SSL_OP_EPHEMERAL_RSA } = require('constants');
const { time } = require('console');
const os = require('os');

helper.init(require.resolve('node-red'));

// Create a platform-independent temp directory path
const tempDir = process.env.TEMP || os.tmpdir();
const tempFilePath = path.join(tempDir, 'test.proto');

describe('protobuf protofile node', function () {

  afterEach(function () {
    helper.unload();
    should();
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (err) {
      console.error("Error cleaning up temp file:", err);
    }
  });

  it('test.proto should be loadable', function (done) {
    fs.access('test/assets/test.proto', (error) => {
        if (!error) done();
    });
  });

  it('should be loaded', function (done) {
    var flow = [{ id: 'n1', type: 'protobuf_file', name: 'test name', protopath: 'test/assets/test.proto' }];
    helper.load(protofile, flow, function () {
      var n1 = helper.getNode('n1');
      n1.should.have.property('name', 'test name');
      n1.should.have.property('protopath', 'test/assets/test.proto');
      n1.should.have.property('protoTypes').which.is.a.Object();
      done();
    });
  });

  it('should reload on file change', function (done) {
    // Create tempDir if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    fs.copyFileSync('test/assets/test.proto', tempFilePath);
    var flow = [{ id: 'n1', type: 'protobuf_file', name: 'test name', protopath: tempFilePath }];
    helper.load(protofile, flow, function () {
      fs.copyFileSync('test/assets/complex.proto', tempFilePath);
      let n1 = helper.getNode('n1');
      setTimeout(() => {
        n1.protoTypes.should.have.property('Zaehler_Waerme').which.is.a.Object();
        done();
      }, 25);
    });
  });

  it('should load multiple files', function (done) {
    var flow = [{ id: 'n1', type: 'protobuf_file', name: 'test name', protopath: 'test/assets/test.proto,test/assets/issue3.proto' }];
    helper.load(protofile, flow, function () {
      var n1 = helper.getNode('n1');
      if (!Array.isArray(n1['protopath'])) return done(Error("protopath does not contain multiple files"))
      if (n1['protoTypes']['TestType'] === undefined || n1['protoTypes']['Viessmann'] === undefined) return done(Error('not all types loaded'))
      done()
    });
  });

});
