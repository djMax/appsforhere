'use strict';

var appUtils = require('./appUtils'),
    assert = require('assert'),
    log = require('pine')(),
    PayPalStrategy = require('./payPalStrategy'),
    Token = require('../models/auth/token'),
    PayPalUser = require('../models/auth/payPalUser'),
    PayPalDelegatedUser = require('../models/auth/payPalDelegatedUser'),
    passport = require('passport');

/**
 * Configure the passport strategies for live and for sandbox
 * @param config from Kraken/confit
 */
module.exports = function configurePassport(config) {

    var liwpConfig = config.get('loginWithPayPal');

    for (var env in liwpConfig) {
        createEnvironment(passport, env, liwpConfig);
    }

    /**
     * The identifier for a particular session consists of an optional
     * 'delegate' literal telling is this is not a first-party user
     * and then the mongodb entity id for the user followed by the
     * mongodb entity id for the token. This way, the association of
     * Token entity to User/Delegate is NOT stored in Mongo.
     */
    passport.serializeUser(function serializePassportUser(user, done) {
        var serialized;
        if (user.delegate) {
            serialized = 'delegate*' + user.delegate.id + '*' + user.token.id;
        } else {
            serialized = user.account.id + '*' + user.token.id;
        }
        done(null, serialized);
    });

    /**
     * Lookup both the user/delegate entity and the token and put them into the
     * request "user" object (which Passport does for us)
     */
    passport.deserializeUser(deserializePassportUser);
};

module.exports.attachSession = function (app) {
    /**
     * Setup Pasport authentication right after the core session store is setup
     */
    app.on('middleware:after:session', function addPassportToSession(eventargs) {
        app.use(passport.initialize());
        app.use(passport.session());
        // Put some common things for all dust templates to use
        app.use(function (req, res, next) {
            try {
                res.locals.siteBaseUrl = req.app.kraken.get('siteBaseUrl');
                res.locals.userEmail = req.user ? req.user.entity.email : null;
                res.locals.userCurrency = req.user ? req.user.entity.currency : null;
                res.locals.userEnvironment = req.user ? req.user.entity.environment : null;
            } catch (x) {
                log.error('Failed to set template helpers', x);
            }
            next();
        });
    });
};

function savePassportUserToMongo(env, req, token, profile, done) {
    /**
     * When a user logs in we are going to create a Token mongodb object to store
     * their refresh token (encrypted using a key that only the browser has in a cookie).
     * The access_token will be stored in the session object.
     */
    Token.encryptRefreshToken(token.rt, req.res, function (error, enc_token) {
        if (error) {
            done(error);
            return;
        }
        PayPalUser.findOrCreate({profileId: profile.id},
            {
                email: profile.emails[0].value,
                currency: profile.currency,
                country: profile.country,
                environment: env
            },
            {upsert: true},
            function (err, user) {
                if (err) {
                    return done(err, user);
                }
                var token = new Token({
                    encrypted_refresh_token: enc_token,
                    user_document_id: user._id,
                    last_used: new Date()
                });
                token.save(function (tokErr, tokDoc) {
                    if (!tokErr) {
                        req.session.access_token = token.at;
                    }
                    return done(tokErr, {account: user, token: tokDoc});
                });
            });
    });
}

function envStrategyArgs(env, cfg) {
    var strategyArgs = {
        clientID: cfg.client_id,
        clientSecret: cfg.secret,
        callbackURL: cfg.return_url || 'https://appsforhere.ebayc3.com/oauth/return',
        passReqToCallback: true,
        name: env
    };
    if (cfg.authorizationUrl) {
        strategyArgs.authorizationURL = cfg.authorizationUrl;
    }
    if (cfg.identityUrl) {
        strategyArgs.tokenURL = cfg.identityUrl + 'tokenservice';
        strategyArgs.profileURL = cfg.identityUrl + 'userinfo?schema=openid';
    }
    if (cfg.insecure) {
        strategyArgs.insecure = true;
    }
    if (cfg.secureProtocol) {
        strategyArgs.secureProtocol = cfg.secureProtocol;
    }
    return strategyArgs;
}

function createEnvironment(passport, env, liwpConfig) {
    var envName = env, cfg = liwpConfig[env];
    if (env === 'live') {
        envName = null;
    }
    passport.use(new PayPalStrategy(envStrategyArgs(env, cfg),
        function (req, accessToken, refreshToken, profile, done) {
            savePassportUserToMongo(envName, req, {at: accessToken, rt: refreshToken}, profile, done);
        }
    ));
}

var UserInfo = function (id, entity, token) {
    // Use the "entity" property if you don't care if it's a first-party user or a delegate
    this.id = id;
    this.entity = entity;
    this.token = token;
    if (entity && token) {
        entity.token = token;
        if (entity instanceof PayPalDelegatedUser) {
            token.delegate = this.delegate = entity;
        } else {
            token.account = this.account = entity;
        }
    }
};

/**
 * Setup the access and refresh token infrastructure by putting together elements of
 * the session, the passport user and mongodb
 */
UserInfo.prototype.attachRequest = function (req) {
    var self = this;
    this.request = req;
    this._tokens = {
        access_token_updated: function token_update(newToken) {
            self.request.session.access_token = newToken.access_token;
        },
        refresh_token: function refresh_token(unusedToken, cb) {
            log.verbose('Refreshing access token.');
            assert(self === req.user, 'MISMATCH IN ACTIVE USER AND REFRESH TOKEN USER.');
            Token.decryptRefreshToken(self.request, function (decryptError, realToken) {
                if (decryptError) {
                    req.logout();
                    log.error('Failed to decrypt refresh token %s\n%s', decryptError.message, decryptError.stack);
                    cb(decryptError);
                } else {
                    if (!self._attachedRequestComplete) {
                        self._attachedRequestComplete = true;
                        req.res.on('finish', function () {
                            if (req.user) {
                                log.verbose('Saving updated access token.');
                                req.session.access_token = self._tokens.access_token;
                            }
                        });
                    }
                    cb(null, realToken);
                }
            });
        }
    };
};

UserInfo.prototype.tokens = function () {
    if (!this._tokens.access_token) {
        this._tokens.access_token = this.request.session.access_token;
    }
    return this._tokens;
};

UserInfo.prototype.hereApi = function () {
    return this.entity.hereApi.apply(this.entity, arguments);
};

UserInfo.prototype.hereApiUrl = function () {
    return this.entity.hereApiUrl.apply(this.entity, arguments);
};

function deserializePassportUser(id, done) {
    var parts = id.split('*');
    if (parts.length === 2) {
        // first person
        Token.findOne({_id: parts[1]}, function (err, token) {
            if (err) {
                return done(err);
            }
            PayPalUser.findOne({_id: parts[0]}, function (ppuErr, paypaluser) {
                if (ppuErr) {
                    return done(ppuErr);
                }
                done(null, new UserInfo(id, paypaluser, token));
            });
        });
    } else if (parts.length === 3) {
        // delegate
        Token.findOne({_id: parts[2]}, function (err, token) {
            if (err) {
                return done(err);
            }
            PayPalDelegatedUser.findOne({_id: parts[1]}, function (ppuErr, delegate) {
                if (ppuErr) {
                    return done(ppuErr);
                }
                done(null, new UserInfo(id, delegate, token));
            });
        });
    } else {
        var error = new Error('Invalid passport token.');
        log.error(error.message);
        done(error);
    }
}

module.exports.deserialize = deserializePassportUser;
