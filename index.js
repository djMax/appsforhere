/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2016 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';
var logger = require('pine')();

var mongo = require('./lib/mongo'),
    kraken = require('kraken-js'),
    express = require('express'),
    expressWinston = require('express-winston'),
    configurePassport = require('./lib/passportSetup'),
    PayPalUser = require('./models/auth/payPalUser'),
    PayPalDelegatedUser = require('./models/auth/payPalDelegatedUser'),
    Queue = require('./lib/queue'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    appUtils = require('./lib/appUtils');

/**
 * This class makes the code a little more testable, but make no mistake - this is meant to be a singleton.
 */
var App = module.exports = function AppConstructor() {
    var self = this;
    this.mongoReady = false;
    // Created when we're the master in the listen function.
    this.server = null;
    this.express = require('express')();
    this.options = {
        onconfig: function appsforhereConfiguration(config, next) {
            self.config = config;
            require('./lib/dust-helpers');
            self.configureLogging();
            self.configureMongo();
            appUtils.configure(config);
            configurePassport(config);
            self.configureQueue();
            next(null, config);
        }
    };

    configurePassport.attachSession(this.express);
    // express-winston logger makes sense BEFORE the router.
    this.configureExpressWinston();
    this.express.use(kraken(this.options));
};

util.inherits(App, EventEmitter);

// The kraken generator uses app.listen, but we need to get lower make socket.io work (with sticky cluster routing)
App.prototype.listen = function (port, callback) {
    var sticky = require('sticky-session'), self = this;

    function clusterStart() {
        self.server = require('http').Server(self.express);
        self.socketio = require('socket.io')(self.server);

        var mubsub = require('mubsub')(self.config.get('mongoUrl'), {
            auto_reconnect: true
        });
        // Create the mubsub channel for socket.io with the configured settings
        mubsub.channel('socket.io', self.config.get('socket.io').mubsub);
        self.socketio.adapter(require('socket.io-adapter-mongo')({
            client: mubsub
        }));
        // There's a problem with socket.io-adapter-mongo in that it doesn't catch channel errors
        // and that brings down the server. They can happen in 'normal operation' for temporary network issues
        mubsub.channels['socket.io'].on('error', function (e) {
            logger.warn('Mubsub error: %s\n%s', e.message, e.stack);
        });
        require('./lib/controllers.io')(self.socketio);

        return self.server;
    }

    var workerCount;
    if (this.config.get('cluster') && (workerCount = this.config.get('cluster').workers)) {
        logger.info('Using %d cluster workers', workerCount);
    } else {
        workerCount = Math.min(6, require('os').cpus().length);
        logger.info('Defaulting to %d cluster workers (%d cpus)', workerCount, require('os').cpus().length);
    }
    if (workerCount > 1) {
        var stickyServer = sticky(workerCount, clusterStart);
        stickyServer.listen(port, function (err) {
            self.emit('listening', err);
            logger.info('[%s] Sticky server listening on http://localhost:%d', self.express.settings.env, port);
            if (callback) { callback(err); }
        });
    } else {
        clusterStart();
        this.server.listen(port, function (err) {
            self.emit('listening', err);
            logger.info('[%s] Standard server listening on http://localhost:%d', self.express.settings.env, port);
            if (callback) { callback(err); }
        });
    }
};

/**
 * The queue monitor will look for delayed jobs and execute them
 */
App.prototype.configureQueue = function () {
    var queueOptions = {
        process: true
    };
    if (process.env.NO_QUEUE_PROCESSING) {
        queueOptions.process = false;
    }
    Queue.init(mongo.db, this.config, queueOptions);
};

/**
 * Setup winston to use MongoDB
 * @param config from Kraken/confit
 */
App.prototype.configureLogging = function () {
    // Make sure the collection is created before we start logging.
    var Log = require('./models/log'), self = this;
    new Log({message: 'Ensuring capped collection.'}).save(function () {
        var MongoDB = require('winston-mongodb').MongoDB;
        // only way to set the default logger config is via the private pine impl
        logger._impl.add(MongoDB, self.config.get('winston-mongodb'));
    });
};

/**
 * Set the mongodb/mongoose connection and use it for the socket.io server
 * once it's connected
 * @param config from Kraken/confit
 */
App.prototype.configureMongo = function () {
    mongo.config(this.config.get('mongoUrl'));
    var self = this;
    mongo.connection.once('connected', function () {
        // This infra needs a mongo connection for session data, so we don't listen until it's up...
        if (!self.mongoReady) {
            self.mongoReady = true;
            self.emit('ready');
        }
    });
};

App.prototype.configureExpressWinston = function () {
    var app = this.express;
    app.on('middleware:after:router', function addExpressWinston() {
        app.use(expressWinston.errorLogger({
            winstonInstance: logger._impl
        }));
    });

    expressWinston.requestWhitelist = ['url', 'headers', 'method', 'httpVersion', 'originalUrl', 'query'];
    expressWinston.bodyWhitelist = ['none'];

    var ewLogger = expressWinston.logger({
        winstonInstance: logger._impl,
        msg: "{{req.method}} {{req.logSafeUrl}} {{res.statusCode}} {{res.responseTime}}ms",
        meta: false
    });
    app.use(function (req, res, next) {
        var badParams = /uuid=(.+[^0-9\-])/g;
        req.logSafeUrl = req.url.replace(badParams, 'uuid=*');
        return ewLogger(req, res, next);
    });
};

App.prototype.close = function (callback) {
    this.server.close(callback);
}
