/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2014 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

var mongoose = require('mongoose');
var logger = require('pine')();
var domain = require('domain');

var db = function () {
    var self = {
        config: function (connStr) {
            if (GLOBAL._hasShutdown) {
                logger.error('Attempting to reconnect to Mongo after process shutdown has begun.');
                return;
            }
            var d = domain.create();
            d.on('error', function (e) {
                logger.error('Mongo related error: %s\n%s', e.toString(), e.stack);
            });
            d.run(function () {
                mongoose.connect(connStr, {auth_reconnect: true, native_parser: true});
                self.db = mongoose.connection.db;
                self.connection = mongoose.connection;
                mongoose.connection.once('connected', function callback() {
                    logger.debug('Mongoose connection established.');
                });
            });
        }
    };
    return self;
};
module.exports = db();
