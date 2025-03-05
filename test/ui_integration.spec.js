const should = require('should');
const helper = require('node-red-node-test-helper');
const protofile = require('../src/nodes/protofile');
// Comment out decode and encode imports if not needed for the tests
// const decode = require('../src/nodes/decode');
// const encode = require('../src/nodes/encode');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Root } = require('protobufjs');

helper.init(require.resolve('node-red'));

describe('ProtoType Preview UI Integration', function() {
    let app, server, port;
    let RED;
    
    // Setup HTTP server for API integration tests
    before(function(done) {
        app = express();
        server = http.createServer(app);
        server.listen(0, function() {
            port = server.address().port;
            
            // Setup RED mock with all required functions
            RED = {
                httpAdmin: app,
                auth: {
                    needsPermission: () => (req, res, next) => next() // Mock permission middleware
                },
                nodes: {
                    getNode: function(id) {
                        return RED.testNodes[id];
                    },
                    createNode: function() {},
                    registerType: function() {} // Mock registerType function
                },
                testNodes: {}
            };
            
            // Setup a mock node with a loaded test proto file
            RED.testNodes['test-proto-node'] = {
                protoTypes: null,
                load: function() {
                    const root = new Root();
                    root.loadSync('test/assets/test.proto');
                    return root;
                }
            };
            
            // Initialize node
            RED.testNodes['test-proto-node'].protoTypes = RED.testNodes['test-proto-node'].load();
            
            // Call the module with our RED mock
            protofile(RED);
            
            done();
        });
    });
    
    after(function(done) {
        server.close(done);
    });
    
    // Integration test: verify the API endpoint returns proper data for our UI component
    it('should provide type definition data in the format expected by the UI', function(done) {
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/protobuf-type-definition/test-proto-node/TestType',
            method: 'GET'
        }, (res) => {
            res.statusCode.should.equal(200);
            
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const result = JSON.parse(data);
                
                // Check that the structure matches what the UI expects
                result.should.have.property('definition');
                result.definition.should.be.a.String();
                
                // The definition should be formatted with line breaks for proper display
                result.definition.should.match(/\n/);
                
                // Should contain the expected message definition
                result.definition.should.match(/message TestType {/);
                
                done();
            });
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
    
    // Test error responses for UI
    it('should return appropriate error responses for the UI to handle', function(done) {
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/protobuf-type-definition/test-proto-node/NonExistingType',
            method: 'GET'
        }, (res) => {
            res.statusCode.should.equal(404);
            
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const result = JSON.parse(data);
                
                // Check that there's an error message the UI can display
                result.should.have.property('error');
                result.error.should.be.a.String();
                result.error.should.match(/Type not found/);
                
                done();
            });
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
});

// Integration test for the decode node configuration
describe('Decode Node ProtoType Preview', function() {
    afterEach(function(done) {
        helper.unload().then(function() {
            done();
        });
    });
    
    it('should have the preview field in the node configuration', function(done) {
        fs.readFile('src/nodes/decode.html', 'utf8', function(err, data) {
            if (err) {
                return done(err);
            }
            
            // Verify the preview HTML structure exists
            data.should.match(/id="protoType-preview-container"/);
            data.should.match(/id="node-input-protoType-preview"/);
            data.should.match(/readonly style="font-family:monospace; height:80px; resize:vertical; width:70%;"/);
            
            // Verify the JavaScript functions for preview exist
            data.should.match(/function updateTypePreview\(typeName\)/);
            data.should.match(/\.getJSON\(`\/protobuf-type-definition\/\$\{protofileId\}\/\$\{typeName\}`/);
            
            done();
        });
    });
});

// Integration test for the encode node configuration
describe('Encode Node ProtoType Preview', function() {
    afterEach(function(done) {
        helper.unload().then(function() {
            done();
        });
    });
    
    it('should have the preview field in the node configuration', function(done) {
        fs.readFile('src/nodes/encode.html', 'utf8', function(err, data) {
            if (err) {
                return done(err);
            }
            
            // Verify the preview HTML structure exists
            data.should.match(/id="protoType-preview-container"/);
            data.should.match(/id="node-input-protoType-preview"/);
            data.should.match(/readonly style="font-family:monospace; height:80px; resize:vertical; width:70%;"/);
            
            // Verify the JavaScript functions for preview exist
            data.should.match(/function updateTypePreview\(typeName\)/);
            data.should.match(/\.getJSON\(`\/protobuf-type-definition\/\$\{protofileId\}\/\$\{typeName\}`/);
            
            done();
        });
    });
});

// Tests for the HTML/JS UI components
describe('ProtoType Preview HTML and JS', function() {
    it('should have the required HTML and JS elements in the decode node', function(done) {
        fs.readFile('src/nodes/decode.html', 'utf8', function(err, data) {
            if (err) {
                return done(err);
            }
            
            // Check for the preview container and textarea
            data.should.match(/id="protoType-preview-container"/);
            data.should.match(/id="node-input-protoType-preview"/);
            data.should.match(/readonly style="font-family:monospace; height:80px; resize:vertical; width:70%;"/);
            
            // Check for the JS functions
            data.should.match(/function updateTypePreview\(/);
            data.should.match(/\.getJSON\(`\/protobuf-type-definition\//);
            
            done();
        });
    });
    
    it('should have the required HTML and JS elements in the encode node', function(done) {
        fs.readFile('src/nodes/encode.html', 'utf8', function(err, data) {
            if (err) {
                return done(err);
            }
            
            // Check for the preview container and textarea
            data.should.match(/id="protoType-preview-container"/);
            data.should.match(/id="node-input-protoType-preview"/);
            data.should.match(/readonly style="font-family:monospace; height:80px; resize:vertical; width:70%;"/);
            
            // Check for the JS functions
            data.should.match(/function updateTypePreview\(/);
            data.should.match(/\.getJSON\(`\/protobuf-type-definition\//);
            
            done();
        });
    });
}); 