import _ from 'lodash'
import Queue from 'queue-async'
import createStripe from 'stripe'
import {createAuthMiddleware} from 'fl-auth-server'
import createStripeCustomer from './models/createStripeCustomer'

const defaults = {
  route: '/api/stripe',
  manualAuthorisation: false,
  cardWhitelist: ['id', 'country', 'brand', 'last4'],
  currency: 'aud',
  maxAmount: 500 * 100, // $500
}

function sendError(res, err, msg) {
  console.log('[fl-stripe-server] error:', err)
  res.status(500).send(msg || err && err.toString())
}

export default function createStripeController(_options) {
  const options = _.defaults(_options, defaults)
  const {app, User} = options
  if (!app) return console.error('createStripeController requires an `app` option, got', _options)
  if (!User) return console.error('createStripeController requires a `User` option, got', _options)

  const StripeCustomer = options.StripeCustomer || createStripeCustomer(User)
  const stripe = createStripe(options.apiKey || process.env.STRIPE_API_KEY)

  // Authorisation check. Make sure we can only work with cards (StripeCustomer models) belonging to the logged in user
  function canAccess(options, callback) {
    const {user} = options
    if (!user) return callback(null, false)
    if (user.admin) return callback(null, true)
    // No additional options; use the logged in user id as the context for all interactions wth Stripe
    callback(null, true)
  }

  function createCard(req, res) {
    const token = req.body.token // obtained with Stripe.js
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, 'Error creating new customer')
      let card = {}
      const queue = new Queue(1)

      // Add the new card to the current record if it exists
      if (customer) {
        queue.defer(callback => {
          stripe.customers.createSource(customer.stripeId, {source: token}, (err, _card) => {
            if (err) return callback(new Error('Stripe error creating new card'))
            card = _card
            callback()
          })
        })
      }

      // Otherwise create a new customer with the given card token
      else {
        queue.defer(callback => {
          stripe.customers.create({description: `User ${req.user.email}`, source: token}, (err, customerJSON) => {
            if (err) return sendError(res, err, 'Stripe error creating customer')

            if (customerJSON.sources && customerJSON.sources.data) card = customerJSON.sources.data[0]
            const customerModel = new StripeCustomer({user_id: userId, stripeId: customerJSON.id})

            customerModel.save(err => {
              if (err) return callback(new Error('Error saving new customer'))
              callback()
            })
          })
        })
      }

      queue.await(err => {
        if (err) return sendError(res, err)
        res.json(_.pick(card, options.cardWhitelist))
      })
    })
  }

  function listCards(req, res) {
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, `Error retrieving customer for user ${userId}`)
      if (!customer) return res.json([])

      stripe.customers.retrieve(customer.stripeId, (err, remoteCustomer) => {
        if (err) return sendError(res, err, 'Stripe error retrieving payment information')

        stripe.customers.listCards(customer.stripeId, (err, json) => {
          if (err) return sendError(res, err, 'Stripe error retrieving payment information')

          res.json(_.map(json.data, card => {
            const cardData = _.pick(card, options.cardWhitelist)
            cardData.default = remoteCustomer.default_source === cardData.id
            return cardData
          }))
        })
      })
    })
  }

  function setDefaultCard(req, res) {
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, `Error retrieving customer for user ${userId}`)
      if (!customer) return res.status(404)

      stripe.customers.update(customer.stripeId, {default_source: cardId}, err => {
        if (err) return sendError(res, err, 'Stripe error setting default card')
        res.json({ok: true})
      })
    })
  }

  function deleteCard(req, res) {
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, `Error retrieving customer for user ${userId}`)
      if (!customer) return res.status(404)

      stripe.customers.deleteCard(customer.stripeId, cardId, err => {
        if (err) return sendError(res, err, 'Stripe error creating new card')
        res.json({id: customer.id})
      })
    })
  }

  function chargeCustomer(req, res) {
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, `Error retrieving customer for user ${userId}`)
      if (!customer) return res.status(404)

      const amount = +req.body.amount
      if (!amount) return res.status(400).send('[fl-stripe-server] Missing an amount to charge')
      if (amount > options.maxAmount) return res.status(401).send('[fl-stripe-server] Charge exceeds the configured maximum amount')

      stripe.charges.create({
        amount,
        currency: options.currency,
        customer: customer.stripeId,
      }, err => {
        if (err) return sendError(res, err, 'Stripe error charging customer')
        return res.json({ok: true})
      })
    })
  }

  function listPlans(req, res) {
    stripe.plans.list((err, json) => {
      if (err) return sendError(res, err, 'Stripe error retrieving plans')
      res.json(json.data)
    })
  }

  function showSubscription(req, res) {
    const cardId = req.params.id
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, `Error retrieving customer for user ${userId}`)
      if (!customer) return res.status(404)

      stripe.customers.deleteCard(customer.stripeId, cardId, err => {
        if (err) return sendError(res, err, 'Stripe error creating new card')
        res.json({id: customer.id})
      })
    })
  }

  function subscribeToPlan(req, res) {
    const {planId} = req.params
    const userId = req.user.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
      if (err) return sendError(res, err, `Error retrieving customer for user ${userId}`)
      if (!customer) return res.status(404)

      let subscription
      const queue = new Queue(1)

      queue.defer(callback => {
        stripe.subscriptions.create({customer: customer.stripeId, plan: planId}, (err, _subscription) => {
          if (err) return callback(new Error('Stripe error subscribing to plan'))
          subscription = _subscription
          callback()
        })
      })

      if (options.onSubscribe) queue.defer(callback => options.onSubscribe({user: req.user, planId, subscription}, callback))

      queue.await(err => {
        if (err) return sendError(res, err)
        res.json({subscription})
      })
    })
  }

  const auth = options.manualAuthorisation ? options.auth : [...options.auth, createAuthMiddleware({canAccess})]

  app.post(`${options.route}/cards`, auth, createCard)
  app.get(`${options.route}/cards`, auth, listCards)
  app.put(`${options.route}/cards/default`, auth, setDefaultCard)
  app.delete(`${options.route}/cards/:id`, auth, deleteCard)

  app.post(`${options.route}/charge`, auth, chargeCustomer)

  app.get(`${options.route}/plans`, listPlans)

  app.get(`${options.route}/subscription`, auth, showSubscription)
  app.put(`${options.route}/subscribe/:planId`, auth, subscribeToPlan)

  return {
    canAccess,
    createCard,
    listCards,
    deleteCard,
    setDefaultCard,
    chargeCustomer,
    listPlans,
    StripeCustomer,
  }
}
