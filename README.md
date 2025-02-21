# @bveenema/node-red-protobuf

This project features protobuf encode/decode nodes. Load a proto file, supply a desired type for encoding or decoding and have fun.

## Installation

To install run

```bash
npm install --production --save node-red-contrib-protobuf 
```

Omit the `--production` flag, in order to install the development dependencies for testing and coverage. Omit `--save` if you don't want to add it to your package.json.

This node depends on protobufjs as the main package and will install it along with it.

## Usage

1. Place an encode/decode node on a flow
2. Configure the protofile path pointing to your protobuf file(s)
3. Either supply a proto type
    1. within the encode/decode configuration
    2. with the `msg.protobufType` field (takes precedence over node configuration)
4. Either send a `protobuf` encoded payload to the decode node or a `JSON` encoded payload to the encode node

*Note on the protofile node* The proto file node watches the specified file(s) for changes on the filesystem through nodejs fs API. If the file contents of the `.proto`-file change on disk, the file becomes reloaded. This may happen multiple times at once due to OS and editor specifics. If multiple comma-separated paths are specified, only the first one is monitored right now to save some resources.

## Features

* Encode JSON payload to protobuf messages
* Decode protobuf messages to JSON payload
* Load protobuf file(s) from the local file system
* Consider protos from one or multiple protobuf files (including inheritance)

## Contribution

To setup your local development environment first clone this repository, then use a container runtime to get your node-red environment up and running.

Using Podman:
```bash
podman run -p 1880:1880 -v $(pwd):/tmp/node-red-contrib-protobuf -d --name nodered-contrib-protobuf_plus nodered/node-red
```

Or using Docker:
```bash
# For Linux/Mac:
docker run -p 1880:1880 -v "$(pwd)":/tmp/node-red-contrib-protobuf -d --name nodered-contrib-protobuf_plus nodered/node-red

# For Windows PowerShell:
docker run -p 1880:1880 -v ${PWD}:/tmp/node-red-contrib-protobuf -d --name nodered-contrib-protobuf_plus nodered/node-red
```

After you saved your changes to the code update the installation within the container with this command:

For Podman:
```bash
podman exec -it nodered-contrib-protobuf_plus npm install /tmp/node-red-contrib-protobuf/ && podman restart nodered-contrib-protobuf_plus
```

For Docker:
```bash
# For Linux/Mac:
docker exec -it nodered-contrib-protobuf_plus npm install /tmp/node-red-contrib-protobuf/ && docker restart nodered-contrib-protobuf_plus

# For Windows PowerShell:
docker exec -it nodered-contrib-protobuf_plus npm install /tmp/node-red-contrib-protobuf/; docker restart nodered-contrib-protobuf_plus 
```

*Note: On SELinux enabled machines it's necessary to allow containers access to your working directory like this: `chcon -t container_file_t $(pwd)`*

### Testing and Coverage-Report

First `npm install` for the dev dependencies. Tests, linting and code coverage are then available through:

```bash
npm test
npm run coverage
npm run lint
```

## License

The BSD 3-Clause License

## Contributors
Forked and enhanced from original project [node-red-contrib-protobuf](https://github.com/w4tsn/node-red-contrib-protobuf) by [Alexander Wellbrock](https://w4tsn.github.io/blog)


## Roadmap

- Better file and type selection UI
- Option to split fields into separate messages
