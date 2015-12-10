/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2014 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

/**
 * Module dependencies.
 */
var util = require('util'),
    logger = require('pine')(),
    OAuth2Strategy = require('passport-oauth').OAuth2Strategy,
    InternalOAuthError = require('passport-oauth').InternalOAuthError,
    appUtils = require('./appUtils');

/**
 * `Strategy` constructor.
 *
 * The PayPal authentication strategy authenticates requests by delegating to
 * PayPal using the OAuth 2.0 protocol.
 *
 * Applications must supply a `verify` callback which accepts an `accessToken`,
 * `refreshToken` and service-specific `profile`, and then calls the `done`
 * callback supplying a `user`, which should be set to `false` if the
 * credentials are not valid.  If an exception occured, `err` should be set.
 *
 * Options:
 *   - `clientID`      your application's App ID
 *   - `clientSecret`  your application's App Secret
 *   - `callbackURL`   URL to which PayPal will redirect the user after granting authorization
 *
 * Examples:
 *
 *     passport.use(new PayPalStrategy({
 *         clientID: '123-456-789',
 *         clientSecret: 'shhh-its-a-secret'
 *         callbackURL: 'https://www.example.net/auth/paypal/callback'
 *       },
 *       function(accessToken, refreshToken, profile, done) {
 *         User.findOrCreate(..., function (err, user) {
 *           done(err, user);
 *         });
 *       }
 *     ));
 *
 * @param {Object} options
 * @param {Function} verify
 * @api public
 */
function Strategy(options, verify) {
    options = options || {};
    options.authorizationURL = options.authorizationURL || 'https://www.paypal.com/webapps/auth/protocol/openidconnect/v1/authorize';
    options.tokenURL = options.tokenURL || 'https://api.paypal.com/v1/identity/openidconnect/tokenservice';

    OAuth2Strategy.call(this, options, verify);

    if (options.secureProtocol || options.insecure) {
        var superExecute = this._oauth2._executeRequest;
        this._oauth2._executeRequest = function( http_library, http_options ) {
            if (options.insecure) {
                http_options.rejectUnauthorized = false;
            }
            if (options.secureProtocol) {
                http_options.secureProtocol = options.secureProtocol;
                http_options.agent = false;
            }
            superExecute.apply(this, arguments);
        };
    }

    this.localInit(options);
    this._oauth2.setAccessTokenName('access_token');
}

/**
 * Inherit from `OAuth2Strategy`.
 */
util.inherits(Strategy, OAuth2Strategy);

Strategy.prototype.localInit = function (options) {
    this.profileURL = options.profileURL || 'https://api.paypal.com/v1/identity/openidconnect/userinfo?schema=openid';
    this.hereApi = options.hereApi || appUtils.hereApi();
    this.name = options.name;
};

/**
 * Retrieve user profile from PayPal.
 *
 * This function constructs a normalized profile, with the following properties:
 *
 *   - `provider`         always set to `paypal`
 *   - `id`
 *   - `displayName`
 *
 * @param {String} accessToken
 * @param {Function} done
 * @api protected
 */
Strategy.prototype.userProfile = function (accessToken, done) {
    var t = this;
    this._oauth2.get(this.profileURL, accessToken, function (err, body, res) {
        if (err) {
            return done(new InternalOAuthError('failed to fetch user profile', err));
        }

        try {
            var json = JSON.parse(body);

            var profile = { provider: 'paypal' };
            profile.id = json.user_id;
            profile.displayName = json.name;
            profile.name = { familyName: json.family_name,
                givenName: json.given_name,
                formatted: json.name };
            profile.emails = [];
            profile.emails.push({ value: json.email });
            profile.country = json.address ? json.address.country : null;

            profile._raw = body;
            profile._json = json;

            var statusURL = appUtils.hereApiUrl(t.name, 'status');
            appUtils.hereApi(t.name).get({
                tokens: { access_token: accessToken },
                json: true,
                url: statusURL
            }, function (statusErr, statusRz) {
                if (statusErr) {
                    logger.error('Error fetching hereapi status: %s', statusErr);
                }
                if (statusRz) {
                    profile.currency = statusRz.currencyCode;
                }
                done(statusErr, profile);
            });
        } catch (e) {
            done(e);
        }
    });
};

/**
 * Expose `Strategy`.
 */
module.exports = Strategy;
