var express = require('express')
  , app = express()
  , fs = require('fs')
  , path = require('path')
  , server = require("http").createServer(app)
  , io = require('socket.io').listen(server)
  , arDrone = require('node-bebop')
  ;
var gamepad = require("gamepad");

// Initialize the library
gamepad.init();

// List the state of all currently attached devices
for (var i = 0, l = gamepad.numDevices(); i < l; i++) {
    console.log(i, gamepad.deviceAtIndex());
}

// Fetch configuration
try {
    var config = require('./config');
} catch (err) {
    console.log("Missing or corrupted config file. Have a look at config.js.example if you need an example.");
    process.exit(-1);
}
  

// Override the drone ip using an environment variable,
// using the same convention as node-ar-drone
var drone_ip = process.env.DEFAULT_DRONE_IP || '192.168.1.1';

// Keep track of plugins js and css to load them in the view
var scripts = []
  , styles = []
  ;

app.configure(function () {
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');
    app.set('view engine', 'ejs', { pretty: true });
    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(app.router);
    app.use(express.static(path.join(__dirname, 'public')));
    app.use("/components", express.static(path.join(__dirname, 'bower_components')));
});

app.configure('development', function () {
    app.use(express.errorHandler());
    app.locals.pretty = true;
});

app.get('/', function (req, res) {
    res.render('index', {
        title: 'WebFlight'
        ,scripts: scripts
        ,styles: styles
        ,options: {
          keyboard: config.keyboard
        }
    });
});

function navdata_option_mask(c) {
  return 1 << c;
}

// Connect and configure the drone
var client = new arDrone.createClient();

client.connect(function (){

    
    //client.PictureSettings.autoWhiteBalanceSelection(0);
    //client.PictureSettings.expositionSelection(0);
    //client.PictureSettings.saturationSelection(0);
        client.videoEnable(1);
});

// Add a handler on navdata updates
var movement = {
            roll : 0,
            pitch : 0,
            yaw: 0,
            altitude : 0,
            speed : 0
            // no idea...
        };

client.on("navdata", function (d) {
    latestNavData = d;
});

// Signal landed and flying events.
client.on('landing', function () {
  console.log('LANDING');
  io.sockets.emit('landing');
});
client.on('landed', function () {
  console.log('LANDED');
  io.sockets.emit('landed');
});
client.on('takeoff', function() {
  console.log('TAKEOFF');
  io.sockets.emit('takeoff');
});
client.on('hovering', function() {
  console.log('HOVERING');
  io.sockets.emit('hovering');
});
client.on('flying', function() {
  console.log('FLYING');
  io.sockets.emit('flying');
});

client.on('battery', function(data) {
  console.log('Batterie: '+data);
  io.sockets.emit('battery', data);
});

// Process new websocket connection
io.set('log level', 1);
io.sockets.on('connection', function (socket) {
  socket.emit('event', { message: 'Welcome to cockpit :-)' });
});

client.on('AltitudeChanged', function(data) {
  //console.log('Altitude: '+data);
  movement.altitude = data;
});
client.on('SpeedChanged', function(data) {
  //console.log('Speed: '+data);
  movement.speed = data;
});
client.on('AttitudeChanged', function(data) {
  
  movement.roll = data.roll;
  movement.pitch = data.pitch;
  movement.yaw  = data.yaw * 180 / Math.PI;
  //console.log('Attitude: '+movement.roll);
});
        

// Schedule a time to push navdata updates
var pushNavData = function() {
    io.sockets.emit('movement', movement);
};
var navTimer = setInterval(pushNavData, 100);

// Prepare dependency map for plugins
var deps = {
    server: server
  , app: app
  , io: io
  , client: client
  , config: config
};


// Load the plugins
var dir = path.join(__dirname, 'plugins');
function getFilter(ext) {
    return function(filename) {
        return filename.match(new RegExp('\\.' + ext + '$', 'i'));
    };
}

config.plugins.forEach(function (plugin) {
    console.log("Loading " + plugin + " plugin.");

    // Load the backend code
    require(path.join(dir, plugin))(plugin, deps);

    // Add the public assets to a static route
    if (fs.existsSync(assets = path.join(dir, plugin, 'public'))) {
      app.use("/plugin/" + plugin, express.static(assets));
    }

    // Add the js to the view
    if (fs.existsSync(js = path.join(assets, 'js'))) {
        fs.readdirSync(js).filter(getFilter('js')).forEach(function(script) {
            scripts.push("/plugin/" + plugin + "/js/" + script);
        });
    }

    // Add the css to the view
    if (fs.existsSync(css = path.join(assets, 'css'))) {
        fs.readdirSync(css).filter(getFilter('css')).forEach(function(style) {
            styles.push("/plugin/" + plugin + "/css/" + style);
        });
    }
});

// Start the web server
server.listen(app.get('port'), function() {
  console.log('AR. Drone WebFlight is listening on port ' + app.get('port'));
});

var drone = client;

// Create a game loop and poll for events
setInterval(gamepad.processEvents, 16);
// Scan for new gamepads as a slower rate
setInterval(gamepad.detectDevices, 500);

setInterval(move, 24);

var posMov = {
    x: 0,
    y: 0
};

var posRel = {
    up: 0,
    side: 0
};

function move()
{
    var activate = 1;
    if(nearZero(posMov.x) && nearZero(posMov.y))
    {
        activate = 0;
        posMov.x = 0;
        posMov.y = 0;
    }
    drone._pcmd = {
        flag: activate,
        roll: posMov.x,
        pitch: posMov.y,
        yaw: posRel.side,
        gaz: posRel.up,
    };


}

function nearZero(value)
{
    return (value > -20 && value < 20);
}

// Listen for move events on all gamepads
gamepad.on("move", function (id, axis, value) {
    /*console.log("move", {
        id: id,
        axis: axis,
        value: value,
    });*/

    value = Math.trunc(value * 100);
    if(nearZero(value))
    {
        value = 0;
    }
    if(axis == 1)
    {
        posRel.up = value;
    }else if(axis == 0)
    {
        posRel.side = value;
    }else if(axis == 3)
    {
        posMov.y = value;
    }else if(axis == 2)
    {
        posMov.x = value;
    }
});

// Listen for button up events on all gamepads
gamepad.on("up", function (id, num) {
    console.log("up", {
        id: id,
        num: num,
    });
});

// Listen for button down events on all gamepads
gamepad.on("down", function (id, num) {
    console.log("down", {
        id: id,
        num: num,
    });
    var perDegree = 3;
    if(num == 0)
    {
        camMov.tilt += perDegree;
        moveCam();
    }else if(num == 1)
    {
        camMov.tilt += -perDegree;
        moveCam();
    }else if(num == 2)
    {
        camMov.pan += -perDegree;
        moveCam();
    }else if(num == 3)
    {
        camMov.pan += perDegree;
        moveCam();
    }else if( num == 4)
    {
        toggleFly();
    }else if(num == 5)
    {
        drone.emergency();
        isFlying = false;
    }else if(num == 8)
    {
        camMov = {
            tilt: 0,
            pan: 0
        };
        moveCam();
    }else if(num == 11)
    {
        toggleRecord();
    }
});

var camMov = {
    tilt: 0,
    pan: 0
};

function moveCam()
{
    drone.Camera.orientation(camMov);
    if(camMov.tilt > 180)
        camMov.tilt = 180;
    if(camMov.tilt < -180)
        camMov.tilt = -180;
    
    if(camMov.pan > 180)
        camMov.pan = 180;
    if(camMov.pan < -180)
        camMov.pan = -180;
}

var isRecording = false;
function toggleRecord()
{
    if(isRecording)
    {
        console.log("Stop recording.");
        drone.stopRecording();
        isRecording = false;
    }else {
        console.log("Start recording.");
        drone.startRecording();
        isRecording = true;
    }
}

var isFlying = false;
function toggleFly()
{
    if(isFlying)
    {
        drone.land();
        isFlying = false;
    }else {
        drone.takeoff();
        isFlying = true;
    }
}

