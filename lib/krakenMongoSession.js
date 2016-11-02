/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2016 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

var mongo = require('./mongo');
var session = require('express-session');
var MongoStore = require('connect-mongo')(session);

module.exports = function mongosession(settings, settingsConfig) {
    module.exports.settings = settings;
    module.exports.store = settings.store = new MongoStore({
        mongooseConnection: mongo.connection,
        autoReconnect: true
    });
    return session(settings);
};
