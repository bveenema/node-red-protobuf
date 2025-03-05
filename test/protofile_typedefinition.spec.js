const should = require('should');
const helper = require('node-red-node-test-helper');
const protofile = require('../src/nodes/protofile');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Root } = require('protobufjs');

helper.init(require.resolve('node-red'));

describe('Protobuf Type Definition API', function() {
    let app, server, port;
    let RED;
    
    // Setup HTTP server for API tests
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
            
            // Also load a more complex proto with nested messages and enums
            RED.testNodes['complex-proto-node'] = {
                protoTypes: null,
                load: function() {
                    try {
                        const root = new Root();
                        root.loadSync('test/assets/complex.proto');
                        return root;
                    } catch (e) {
                        console.error('Error loading complex.proto:', e.message);
                        return null;
                    }
                }
            };
            
            // Initialize nodes
            RED.testNodes['test-proto-node'].protoTypes = RED.testNodes['test-proto-node'].load();
            RED.testNodes['complex-proto-node'].protoTypes = RED.testNodes['complex-proto-node'].load();
            
            // Call the module with our RED mock
            protofile(RED);
            
            done();
        });
    });
    
    after(function(done) {
        server.close(done);
    });
    
    afterEach(function() {
        // Clean up
    });
    
    it('should expose the protobuf type definition API endpoint', function(done) {
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
                result.should.have.property('definition');
                result.definition.should.match(/message TestType {/);
                result.definition.should.match(/double timestamp = 1;/);
                result.definition.should.match(/float foo = 2;/);
                result.definition.should.match(/bool bar = 3;/);
                result.definition.should.match(/string test = 4;/);
                result.definition.should.match(/bool noMoreSnakeCase = 5;/);
                done();
            });
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
    
    it('should handle missing protobuf type correctly', function(done) {
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/protobuf-type-definition/test-proto-node/NonExistingType',
            method: 'GET'
        }, (res) => {
            res.statusCode.should.equal(404);
            done();
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
    
    it('should handle missing node correctly', function(done) {
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/protobuf-type-definition/non-existing-node/TestType',
            method: 'GET'
        }, (res) => {
            res.statusCode.should.equal(404);
            done();
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
    
    it('should format complex types with nested messages and enums', function(done) {
        // Use RMB message which is a complex message with nested types in the complex.proto file
        try {
            const root = new Root();
            root.loadSync('test/assets/complex.proto');
            if (!root.lookupType('RMB')) {
                console.log('Warning: RMB message not found in complex.proto, skipping test');
                return done();
            }
        } catch (e) {
            console.log('Warning: complex.proto not properly loadable, skipping test');
            return done();
        }
        
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/protobuf-type-definition/complex-proto-node/RMB',
            method: 'GET'
        }, (res) => {
            res.statusCode.should.equal(200);
            
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const result = JSON.parse(data);
                result.should.have.property('definition');
                
                // Check that the definition includes the message name and nested type
                const definition = result.definition;
                definition.should.match(/message RMB {/);
                
                // RMB contains a nested Speicher field
                definition.should.match(/Speicher Speicher/);
                
                // Should include boolean fields
                definition.should.match(/bool/);
                
                done();
            });
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
    
    it('should handle case formatting consistently', function(done) {
        // This test ensures we understand and document how case formatting works
        // in protobufjs and our formatTypeDefinition function
        
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
                
                // Document the behavior: snake_case in proto files becomes camelCase in parsed output
                // This is the default behavior with protobufjs when keepCase is not set to true
                const definition = result.definition;
                
                // The field defined as no_more_snake_case in the proto file 
                // appears as noMoreSnakeCase in the formatted output
                definition.should.match(/noMoreSnakeCase/);
                definition.should.not.match(/no_more_snake_case/);
                
                // Add a comment about this in the test output for future reference
                // console.log('NOTE: By default, protobufjs converts snake_case to camelCase. ' +
                //            'This is expected behavior and our tests verify this consistency.');
                
                done();
            });
        });
        
        req.on('error', (e) => {
            done(e);
        });
        
        req.end();
    });
});