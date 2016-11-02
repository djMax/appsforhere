/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2016 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';
var logger = require('pine')(),
    domain = require('domain'),
    fs = require('fs'),
    path = require('path'),
    finder = require('findit'),
    passportSocketIo = require('passport.socketio'),
    logger = require('pine')();

var shuttingDown = false;

module.exports = function (io, sessionStore, cookieParser) {
    if (shuttingDown) {
        console.log('Socket shutdown');
        return;
    }
    var controllers = [], ready = false;
    var socketList = [];
    var controllerEmitter = finder(path.resolve(__dirname, '../controllers.io'));

    controllerEmitter.on('file', function (f) {
        if (path.extname(f).toLowerCase() === '.js') {
            var reqpath = path.relative(__dirname, f);
            logger.debug('Loading socket.io controller at %s', reqpath);
            controllers.push(require(reqpath));
        }
    });

    controllerEmitter.on('end', function () {
        logger.debug('Completed socket.io controller setup (Loaded %d modules).', controllers.length);
        ready = true;
    });

    /**
     * Gracefully shutdown when pm2 shuts down by closing all the sockets. Since we'll take longer
     * than Kraken shutdown, we're in charge of process.exit(0)
     */
    process.on('message', function (msg) {
        if (msg === 'shutdown') {
            console.log('Shutting down socket.io');
            shuttingDown = true;
            try {
                socketList.forEach(function (socket) {
                    socket.disconnect();
                });
            } catch (x) {
                console.log('socket.io shutdown failed.', x.message);
            }
            setTimeout(function () {
                process.exit(0);
            }, 1000);
        }
    });

    // Get our session settings from express to use in socket.io connections, which are
    // not going through the same pipeline
    var session = require('./krakenMongoSession');
    io.use(passportSocketIo.authorize({
        cookieParser: require('cookie-parser'),
        key: 'connect.sid',       // the name of the cookie where express/connect stores its session_id
        secret: session.settings.secret,    // the session_secret to parse the cookie
        store: session.store,        // we NEED to use a sessionstore. no memorystore please
        success: onAuthorizeSuccess,
        fail: onAuthorizeFail
    }));

    function onAuthorizeSuccess(data, accept) {
        if (!ready) {
            logger.error('Socket connected before server is ready.');
            throw new Error('Server starting up.');
        }
        logger.info('Auth success.');
        accept();
    }

    function onAuthorizeFail(data, message, error, accept) {
        if (error) {
            logger.error('connection failure: %s\n%s', error.toString(), error.stack);
            throw new Error(message);
        }
        // Not an authorized user, but let downstream handlers decide if that's ok.
        logger.info('Auth fail but accepting anyways.', message);
        accept();
    }

    io.on('connection', function (socket) {
        if (socket.request.user.logged_in) {
            logger.info('socket.io connection from %s (%s) #%s', socket.conn.remoteAddress, socket.request.user.entity._id.toString(), socket.id);
        } else {
            logger.info('socket.io unauthenticated connection from %s #%s', socket.conn.remoteAddress, socket.id);
        }
        socketList.push(socket);
        socket.on('close', function () {
            socketList.splice(socketList.indexOf(socket), 1);
        });
        var d = domain.create();
        socket.request.activeDomain = d;
        d.on('error', function (err) {
            try {
                // handle the error safely
                logger.error('Uncaught exception! %s\n%s', err.message, err.stack);
            } catch (x) {
            }
            socket.disconnect();
        });
        socket.request.$eat = function (fn) {
            return d.intercept(fn);
        };
        d.add(socket);
        d.run(function () {
            for (var i = 0, len = controllers.length; i < len; i++) {
                controllers[i](io, socket);
            }
        });
        socket.on('disconnect', function () {
            delete socket.request.activeDomain;
            d.remove(socket);
            d.dispose();
        });
    });

};
