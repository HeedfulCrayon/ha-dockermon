var express = require("express");
var basicAuth = require('express-basic-auth')
var bodyParser = require('body-parser');
var Docker = require('dockerode');
var fs = require('fs');
var config = require('./default_settings.js');
var docker = false;

const logger = function (req, res, next) {
    console.log(`${new Date(Date.now()).toISOString()} ${req.url}`);
    next();
}

//Setup express
var app = express();
app.use(bodyParser.json({
    type: 'application/octet-stream'
}));
app.use(logger);

var debug = config.get('debug');

//If we have set a username and password, require it
if (config.get("http.username")) {
    var authUsers = {
        users: {}
    }
    authUsers.users[config.get("http.username")] = config.get("http.password");
    app.use(basicAuth(authUsers));
}

//Set the container route
app.all('/container/:containerId', (req, res) => {

    if (!req.params.containerId) {
        //This paramater is required
        res.status(400);
        res.send("Container ID is required");
        return;
    }

    var containerId = req.params.containerId;
    //Does this container exist in Docker? If not respond with 404 not found and body of off

    if (req.method == "POST") {
        //First get the container
        if (config.get("debug"))
            console.log("Updating container " + containerId);

        getContainer(containerId, function (container) {
            if (req.body.state == "start") {
                if (config.get("debug"))
                    console.log("Attempting to start container " + container.Id);

                docker.getContainer(container.Id).start(function (err, data) {
                    if (err) {
                        if (config.get("debug")) {
                            console.log("Failed to start container " + container.Id);
                            console.log(err);
                        }

                        res.status(500);
                        res.send(err);
                        return;
                    }
                    if (config.get("debug"))
                        console.log("Container started");

                    res.status(200);
                    res.send({
                        state: "running"
                    });
                });
            } else if (req.body.state == "stop") {
                if (config.get("debug"))
                    console.log("Attempting to stop container " + container.Id);

                docker.getContainer(container.Id).stop(function (err, data) {
                    if (err) {
                        if (config.get("debug")) {
                            console.log("Failed to stop container " + container.Id);
                            console.log(err);
                        }

                        res.status(500);
                        res.send(err);
                        return;
                    }
                    if (config.get("debug"))
                        console.log("Container stopped");

                    res.status(200); //We found the container! This reponse can be trusted
                    res.send({
                        state: "stopped"
                    });
                });
            } else if (req.body.state == "pause") {
                if (config.get("debug"))
                    console.log("Attempting to pause container " + container.Id);

                docker.getContainer(container.Id).pause(function (err, data) {
                    if (err) {
                        if (config.get("debug")) {
                            console.log("Failed to pause container " + container.Id);
                            console.log(err);
                        }

                        res.status(500);
                        res.send(err);
                        return;
                    }
                    if (config.get("debug"))
                        console.log("Container paused");

                    res.status(200); //We found the container! This reponse can be trusted
                    res.send({
                        state: "paused"
                    });
                });
             } else if (req.body.state == "unpause") {
                if (config.get("debug"))
                    console.log("Attempting to unpause container " + container.Id);

                docker.getContainer(container.Id).unpause(function (err, data) {
                    if (err) {
                        if (config.get("debug")) {
                            console.log("Failed to unpause container " + container.Id);
                            console.log(err);
                        }

                        res.status(500);
                        res.send(err);
                        return;
                    }
                    if (config.get("debug"))
                        console.log("Container unpaused");

                    res.status(200); //We found the container! This reponse can be trusted
                    res.send({
                        state: "running"
                    });
                });
             }
        }, function (status, message) {
            if (config.get("debug"))
                console.log("Failed to get status of Docker container");

            res.status(status);
            if (message) {
                res.send(message);
                if (config.get("debug"))
                    console.log(message);
            }
        })

    } else {
        //We are getting the status of the container
        if (config.get("debug"))
            console.log("Getting status of container " + containerId);
        getContainer(containerId, function(container){
            res.status(200); //We found the container! This response can be trusted
            if (config.get("debug")) {
                console.log("Response received");
                console.log(container);
            }
            res.send({
                state: container.SynoStatus || container.State,
                status: container.Status,
                image: container.Image
            });
        }, function(status, message){
            res.status(status);
            if (config.get("debug"))
                console.log("Failed to get status of Docker container");
            if (message) {
                res.send(message);
                if (config.get("debug"))
                    console.log(message);
            }
        });
    }
});

/**
 * List all of the services
 */
app.get('/services', (req, res) => {
    docker.listServices({ all: true }, function (err, services) {
        if (err) {
            res.status(500);
            res.send(err);
            return;
        }
        res.status(200);
        res.send(services);
    });
});

app.get('/tasks', (req, res) => {
    getAllServiceTasks(function(services) {
        res.status(200);
        res.send(services);
    });
})

app.get('/service/:serviceId', (req, res) => {

    if (!req.params.serviceId) {
        res.status(400);
        res.send("Service ID/Name is required");
        return;
    }

    var serviceId = req.params.serviceId;

    log("Getting status of service " + serviceId);

    getService(serviceId, function(service){
        res.status(200); // Service found
        if (config.get("debug")){
            console.log("Response received");
            console.log(service);
        }
        res.send({
            service: service,
            replicas: service.Spec.Mode.Replicated.Replicas
        });
    })
});

app.get('/service/:serviceId/update', (req, res) => {
    if (!req.params.serviceId) {
        //This paramater is required
        res.status(400);
        res.send("Service ID/Name is required");
        return;
    }

    var serviceId = req.params.serviceId;

    log(`Getting status of service ${serviceId}`);
    getService(serviceId, function(service){
        res.status(200);
        log('Service Status retrieved', service);

        service = docker.getService(service.ID);

        service.inspect(function (err, inspectData){
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }

            spec = inspectData.Spec;
            spec.TaskTemplate.ForceUpdate = 1;
            
            service.update({...spec, version: inspectData.Version.Index}, function (err, data){
                if (err) {
                    res.status(500);
                    res.send(err);
                    return;
                }

                res.status(200);
                log(`Updating Service ${serviceId}`)
                if (data.Warnings){
                    res.send({ status: "Success", warnings: data.Warnings });
                } else {
                    res.send({ status: "Success" });
                }
            })
        });
    })
});

app.get('/service/:serviceId/tasks', async (req, res) => {
    if (!req.params.serviceId) {
        res.status(400);
        res.send("Service ID/Name is required");
        return;
    }

    let serviceId = req.params.serviceId;
    let service = await docker.getService(serviceId).inspect()
    let replicas;
    if (service.Spec.Mode.hasOwnProperty('Global')) {
        replicas = (await docker.listNodes()).length;
    } else {
        replicas = service.Spec.Mode.Replicated.Replicas;
    }
    
    log("Getting tasks of service " + serviceId);
    getServiceTasks(serviceId, (tasks) => {
        res.status(200);
        tasksResult = [];
        tasks.forEach(task => {
            tasksResult.push({
                state: task.Status.State,
                task: task,
                status: task.Status,
                image: task.Spec.ContainerSpec.Image,
                id: task.ID
            });
        });

        let runningTasks = tasksResult.filter(task => task.state === 'running').length;
        let status = 'Running';
        if (runningTasks < replicas && runningTasks > 0) {
            status = 'Degraded (' + runningTasks + '/' + replicas + ')';
        } else if (runningTasks == 0) {
            status = 'Not Running'
        }

        let response = { serviceTasks: tasksResult, status: status }
        log('Response:', response)
        res.send(response);
    })
});

app.get('/service/:serviceId/restart', (req, res) => {

    if (!req.params.serviceId) {
        //This paramater is required
        res.status(400);
        res.send("Service ID/Name is required");
        return;
    }

    var serviceId = req.params.serviceId;

    console.log("Getting tasks of service " + serviceId);
    getServiceTasks(serviceId, (tasks) => {
        res.status(200);
        console.log("Response received");
        console.log(tasks);
        result = [];
        restartErrorResult = [];
        taskRestartResult = [];
        tasks.forEach(task => {
            console.log("Getting container " + task.Status.ContainerStatus.ContainerID);
            getContainer(task.Status.ContainerStatus.ContainerID, (container) => {
                console.log("Restarting container " + container.Id);
                docker.getContainer(container.Id).restart((err, data) => {
                    if (err) {
                        console.log("Error restarting container " + container.Id);
                        restartErrorResult.push({
                            container: container.Id,
                            error: err
                        })
                        res.status(500);
                        res.send(err);
                        return;
                    } 
                    console.log("Successfully restarted container " + container.Id);
                    taskRestartResult.push({
                        container: container.Id,
                        info: data
                    })
                    res.status(200);
                    res.send(data);
                }, (status, message) => {
                    res.status(status);
                    if (message) {
                        res.send(message);
                    }
                }
                )
            })
        });
        result.push({
            errors: restartErrorResult,
            successes: taskRestartResult
        })
        res.send(result);
    })
});

app.get('/nodes', (req, res) => {
    docker.listNodes({ all: true }, (err, nodes) => {
        if (err) {
            res.status(500);
            res.send(err);
            return;
        }
        nodeResults = [];
        nodes.forEach(node => {
            nodeResults.push({
                ID: node.ID,
                Spec: node.Spec,
                Description: { 
                    HostName: node.Description.HostName,
                    Resources: node.Description.Resources
                },
                Status: node.Status,
                ManagerStatus: node.ManagerStatus
            })
        })
        res.status(200);
        res.send(nodeResults);
    });
});

/**
 * List all of the containers
 */
app.get('/containers', (req, res) => {
    docker.listContainers({ all: true }, (err, containers) => {
        if (err) {
            res.status(500);
            res.send(err);
            return;
        }
        res.status(200);
        res.send(containers);
    });
});

/**
 * Restart the container by the ID specified
 */
app.get('/container/:containerId/restart', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Restart " + containerId);

    getContainer(containerId, (container) => {
        docker.getContainer(container.Id).restart((err, data) => {
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }
            res.status(200); //We found the container! This reponse can be trusted
            res.send(data);
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    })
});


/**
 * Start the container by the ID specified
 */
app.get('/container/:containerId/start', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Start " + containerId);

    getContainer(containerId, (container) => {
        docker.getContainer(container.Id).start((err, data) => {
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }
            res.status(200); //We found the container! This reponse can be trusted
            res.send(data);
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    })
});

/**
 * Pause the container by the ID specified
 */
app.get('/container/:containerId/pause', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Pause " + containerId);

    getContainer(containerId, (container) => {
        docker.getContainer(container.Id).pause((err, data) => {
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }
            res.status(200); //We found the container! This reponse can be trusted
            res.send(data);
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    })
});

/**
 * Unpause the container by the ID specified
 */
app.get('/container/:containerId/unpause', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Unpause " + containerId);

    getContainer(containerId, (container) => {
        docker.getContainer(container.Id).unpause((err, data) => {
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }
            res.status(200); //We found the container! This reponse can be trusted
            res.send(data);
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    })
});

/**
 * Stats the container by the ID specified
 */
app.get('/container/:containerId/stats', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Getting Stats for " + containerId);
    var opts= new Object();
    opts.stream = false
    getContainer(containerId, (container) => {
        docker.getContainer(container.Id).stats(opts, (err, data) => {
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }
            res.status(200); //We found the container! This reponse can be trusted
            res.send(data);
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    })
});


/**
 * Stop the container by the ID specified
 */
app.get('/container/:containerId/stop', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Stop " + containerId);

    getContainer(containerId, (container) => {
        docker.getContainer(container.Id).stop((err, data) => {
            if (err) {
                res.status(500);
                res.send(err);
                return;
            }
            res.status(200); //We found the container! This reponse can be trusted
            res.send(data);
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    })
});

app.post('/container/:containerId/exec', (req, res) => {
    var containerId = req.params.containerId;
    console.log("Exec " + containerId);

    var command = req.body.command ? req.body.command : false;
    if (command == "" || !command) {
        res.send({
            status: false,
            error: "No command specified"
        });
        res.status(400);
        return;
    }

    getContainer(containerId, (container) => {
        if (config.get("debug"))
            console.log("Attempting to execute command in container " + container.Id);
        var options = {
            Cmd: command.split(" "),
            AttachStdout: true,
            AttachStderr: true
        };
        if (config.get('debug'))
            console.log(options);

        var container = docker.getContainer(container.Id);
        container.exec(options, (err, exec) => {
            if (err) {
                if (config.get("debug")) {
                    console.log("Failed to get container " + container.Id);
                    console.log(err);
                }

                res.status(500);
                res.send(err);
                return;
            }

            exec.start((err, stream) => {
                if (err) {
                    if (config.get("debug")) {
                        console.log("Failed to execute in container " + container.Id);
                        console.log(err);
                    }

                    res.status(500);
                    res.send(err);
                    return;
                }
                console.log("executed query");
                const chunks = [];
                stream.on("data", (chunk) => {
                    chunks.push(chunk.toString());
                });

                // Send the buffer or you can put it into a var
                stream.on("end", () => {
                    // We remove the first 8 chars as the contain a unicode START OF HEADING followed by ENQUIRY.
                    res.send({
                        status: true,
                        result: chunks.join('').substr(8)
                    });
                });
            });
            return;
        });
    }, (status, message) => {
        res.status(status);
        if (message) {
            res.send(message);
        }
    });
})

//Attempt to connect to the Docker daemon
switch (config.get("docker_connection.type")) {
    case "http":
        var docker = new Docker({ host: config.get("docker_connection.host"), port: config.get("docker_connection.port") });
    break;

    case "socket":
        //Check if the socket is okay
        try{
            let stats = fs.statSync(config.get("docker_connection.path"));

            if (!stats.isSocket()) {
                throw new Error('Unable to connect to Docker socket at ' + config.get("docker_connection.path") + ". Is Docker running?");
            }
        } catch (e) {
            console.error('Unable to connect to Docker socket at ' + config.get("docker_connection.path") + ". Is Docker running?");
            if (config.get("debug"))
                console.log(e);
            process.exit(1);
        }
        //Socket is okay, connect to it
        docker = new Docker({ socketPath: config.get("docker_connection.path") });
    break;

    default:
        throw new Error("Docker connection type " + config.get("docker_connection.type") + " is invalid");
    break;
}

startServer(docker);

function startServer(docker)
{
    var server = app.listen(config.get("http.port"), () => {
        console.log("HA-Dockermon server listening on port " + server.address().port);
    });
}

function getContainer(name, cb, error)
{
    docker.listContainers({ limit:100, filters: { "name": [name] } }, (err, containers) => {
        if (err) {
            if (typeof error == "function")
                return error(500, err);

            return;
        }

        if (containers.length > 0) {
            //What is the ID of this container?
            //We need to only return the ID as it matches exactly
            for(id in containers) {
                //Does this container have names set?
                if (containers[id].Names.length) {
                    //Yes it does, loop over all names to see if we get one
                    for(i in containers[id].Names) {
                        if (containers[id].Names[i] == "/" + name) {
                            //Found it by name!
                            return cb(containers[id]);
                        }
                    }
                }
            }
        }

        //Hmm lets try get the container by ID instead
        docker.listContainers({ filters: { "id": [name] } }, (err, containers) => {
            if (err) {
                if (typeof error == "function")
                    return error(500, err);
    
                return;
            }
    
            if (containers.length < 1) {
                if (typeof error == "function")
                    return error(404, "container not found");
                
                return;
            }
    
            //What is the ID of this container?
            //We need to only return the ID as it matches exactly
            for(id in containers) {
                //Does this container have names set?
                if (containers[id].Names.length) {
                    //Yes it does, check the first name
                    if (containers[id].Id == name) {
                        //Found it by name!
                        return cb(containers[id]);
                    }
                }
            }

            //Could not find that container - sad face
            if (typeof error == "function")
                return error(404, "container not found");
            
            return false;
        });
    });
}

function getService(name, cb, error)
{
    docker.listServices({ limit:100, filters: { "name": [name] } }, (err, services) => {
        if (err) {
            if (typeof error == "function")
                return error(500, err);

            return;
        }

        if (services.length > 0) {
            //What is the ID of this service?
            //We need to only return the ID as it matches exactly
            for(id in services) {
                //Does this service have names set?
                if (services[id].Spec.Name.length) {
                    return cb(services[id]);
                }
            }
        }
    });
}

function getServiceTasks(name, cb, error)
{
    docker.listTasks({ filters: { "service": [name] } }, (err, tasks) => {
        if (err) {
            if (typeof error == "function")
                return error(500, err);

            return;
        }

        if (tasks.length < 1) {
            if (typeof error == "function")
                return error(404, "task with service name not found");
            
            return;
        }

        return cb(tasks);
    })
}

function getAllServiceTasks(cb, error)
{
    docker.listServices({ limit:100 }, async (err, services) => {
        if (err) {
            if (typeof error == "function")
                return error(500, err);

            return;
        }

        nodes = await docker.listNodes();

        if (services.length > 0) {
            var serviceTasks = [];
            for(id in services) {
                let replicas;
                if (!services[id].Spec.Mode.hasOwnProperty('Global')) {
                    replicas = services[id].Spec.Mode.Replicated.Replicas;
                } else {
                    replicas = nodes.length;
                }
                myTaskList = await docker.listTasks({ filters: { "service": [services[id].Spec.Name] } })
                let status = 'Running';
                if (myTaskList.length < replicas && myTaskList.length > 0) {
                    status = 'Degraded (' + myTaskList.length + '/' + replicas + ')';
                } else if (myTaskList.length == 0) {
                    status = 'Not Running'
                }
                serviceTasks.push({ serviceName: services[id].Spec.Name, taskList: myTaskList, status: status })
            }
        }
        return cb(serviceTasks);
    });
}

function log(msg, extra = null)
{
    if (debug){
        console.log(msg);
        if (extra !== null)
        {
            console.log(extra);
        }
    }
}

