'use strict';

exports.__esModule = true;
exports['default'] = createStripeController;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _queueAsync = require('queue-async');

var _queueAsync2 = _interopRequireDefault(_queueAsync);

var _stripe = require('stripe');

var _stripe2 = _interopRequireDefault(_stripe);

var _flAuthServer = require('fl-auth-server');

var _modelsCreateStripeCustomer = require('./models/createStripeCustomer');

var _modelsCreateStripeCustomer2 = _interopRequireDefault(_modelsCreateStripeCustomer);

var defaults = {
  route: '/api/stripe',
  manualAuthorisation: false,
  cardWhitelist: ['id', 'country', 'brand', 'last4']
};

function sendError(res, err, msg) {
  console.log('[fl-stripe-server] error:', err);
  res.status(500).send(msg);
}

function createStripeController(_options) {
  var options = _lodash2['default'].defaults(_options, defaults);
  var app = options.app;
  var User = options.User;

  if (!app) return console.error('createStripeController requires an `app` option, got', _options);
  if (!User) return console.error('createStripeController requires a `User` option, got', _options);

  var StripeCustomer = options.StripeCustomer || _modelsCreateStripeCustomer2['default'](User);
  var stripe = _stripe2['default'](options.apiKey || process.env.STRIPE_API_KEY);

  // Authorisation check. Make sure we can only work with cards (StripeCustomer models) belonging to the logged in user
  function canAccess(options, callback) {
    var user = options.user;
    var req = options.req;

    if (!user) return callback(null, false);
    if (user.admin || user.get('admin')) return callback(null, true);

    // Allow access for the owner of the profile
    if (req.method === 'GET' && req.query.user_id === user.id.toString()) {
      return callback(null, true);
    }

    // Allow creating for logged in user, charging cards
    else if (req.method === 'POST' && req.body.user_id === user.id.toString()) {
        return callback(null, true);
      }

      // We'll set the user id to the logged in user when calling the stripe api, so Stripe will deny any invalid card ids
      else if (req.method === 'DELETE') {
          return callback(null, true);
        }

    // // Allow users to charge their cards
    // else if (req.method === 'PUT') {
    //   return StripeCustomer.exists({id: req.params.id, user_id: user.id}, callback)
    // }

    callback(null, false);
  }

  function createCard(req, res) {
    var token = req.body.token; // obtained with Stripe.js
    var user_id = req.user.id;
    var customer = null;

    // Check for an existing (local) stripe customer record
    StripeCustomer.findOne({ user_id: user_id }, function (err, _customer) {
      if (err) return sendError(res, err, 'Error creating new customer');
      customer = _customer;
      var card = {};
      var queue = new _queueAsync2['default'](1);

      // Create a new customer if we don't have one
      if (!customer) {
        queue.defer(function (callback) {
          stripe.customers.create({ description: 'User ' + req.user.get('email'), source: token }, function (err, customerJSON) {
            if (err) return sendError(res, err, 'Stripe error creating customer');

            if (customerJSON.sources && customerJSON.sources.data) card = customerJSON.sources.data[0];
            customer = new StripeCustomer({ user_id: user_id, stripeId: customerJSON.id });

            customer.save(function (err) {
              if (err) return sendError(res, err, 'Error saving new customer');
              callback();
            });
          });
        });
      }

      // Add the new card to the current record if we do
      else {
          queue.defer(function (callback) {
            stripe.customers.createSource(customer.get('stripeId'), { source: token }, function (err, _card) {
              if (err) return sendError(res, err, 'Stripe error creating new card');
              card = _card;
              callback();
            });
          });
        }

      queue.await(function (err) {
        if (err) return sendError(res, err);
        res.json(_lodash2['default'].pick(card, options.cardWhitelist));
      });
    });
  }

  function listCards(req, res) {
    var user_id = req.user.id;

    StripeCustomer.findOne({ user_id: user_id }, function (err, customer) {
      if (err) return sendError(res, err, 'Error retrieving payment information');
      if (!customer) return res.json([]);

      stripe.customers.listCards(customer.get('stripeId'), function (err, json) {
        if (err) return sendError(res, err, 'Stripe error retrieving payment information');
        res.json(_lodash2['default'].map(json.data, function (card) {
          return _lodash2['default'].pick(card, options.cardWhitelist);
        }));
      });
    });
  }

  function deleteCard(req, res) {
    var user_id = req.user.id;
    var cardId = req.params.id;

    // Check for an existing (local) stripe customer record
    StripeCustomer.findOne({ user_id: user_id }, function (err, customer) {
      if (err) return sendError(res, err, 'Error creating new customer');
      if (!customer) return res.status(404);

      stripe.customers.deleteCard(customer.get('stripeId'), cardId, function (err) {
        if (err) return sendError(res, err, 'Stripe error creating new card');
        res.json({ id: customer.id });
      });
    });
  }

  function chargeCard(req, res) {

    // charge = {
    //    customer: customerId,
    //    source: cardId,
    // }
    return res.json({});
  }

  var auth = options.manualAuthorisation ? options.auth : [].concat(options.auth, [_flAuthServer.createAuthMiddleware({ canAccess: canAccess })]);

  app.post(options.route + '/cards', auth, createCard);
  app.get(options.route + '/cards', auth, listCards);
  app['delete'](options.route + '/cards/:id', auth, deleteCard);

  app.post(options.route + '/charge', auth, chargeCard);

  return {
    canAccess: canAccess,
    createCard: createCard,
    listCards: listCards,
    deleteCard: deleteCard,
    chargeCard: chargeCard,
    StripeCustomer: StripeCustomer
  };
}

module.exports = exports['default'];