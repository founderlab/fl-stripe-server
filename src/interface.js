import _ from 'lodash'
import Queue from 'queue-async'

function createCard(options, callback) {
  const {stripe, source, userId, description, StripeCustomer} = options

  // Check for an existing (local) stripe customer record
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    if (err) return callback(new Error('Error creating new customer'))
    let card = {}
    const queue = new Queue(1)

    // Add the new card to the current record if it exists
    if (customer) {
      queue.defer(callback => {
        stripe.customers.createSource(customer.stripeId, {source}, (err, _card) => {
          if (err) return callback(new Error('Stripe error creating new card'))
          card = _card
          callback()
        })
      })
    }

    // Otherwise create a new customer with the given card token
    else {
      queue.defer(callback => {
        stripe.customers.create({description, source}, (err, customerJSON) => {
          if (err) return callback(new Error('Stripe error creating customer'))

          if (customerJSON.sources && customerJSON.sources.data) card = customerJSON.sources.data[0]
          const customerModel = new StripeCustomer({user_id: userId, stripeId: customerJSON.id})

          customerModel.save(err => {
            if (err) return callback(new Error('Error saving new customer'))
            callback()
          })
        })
      })
    }

    queue.await(err => callback(err, card))
  })
}

function listCards(options, callback) {
  const {stripe, userId, StripeCustomer} = options

  // Check for an existing (local) stripe customer record
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    if (err) return callback(new Error(`Error retrieving customer for user ${user.id}`))
    if (!customer) return callback(null, [])

    stripe.customers.retrieve(customer.stripeId, (err, remoteCustomer) => {
      if (err) return callback(new Error('Stripe error retrieving payment information'))

      stripe.customers.listCards(customer.stripeId, (err, json) => {
        if (err) return callback(new Error('Stripe error retrieving payment information'))

        const cards = _.map(json.data, card => {
          const cardData = _.pick(card, options.cardWhitelist)
          cardData.default = remoteCustomer.default_source === cardData.id
          return cardData
        })
        callback(null, cards)
      })
    })
  })
}

function setDefaultCard(options, callback) {
  const {stripe, userId, cardId, StripeCustomer} = options
  if (!cardId) return callback(new Error('setDefaultCard requires a cardId'))

  // Check for an existing (local) stripe customer record
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    if (err) return callback(new Error(`Error retrieving customer for user ${user.id}`))
    if (!customer) return callback()

    stripe.customers.update(customer.stripeId, {default_source: cardId}, err => {
      if (err) return callback(new Error('Stripe error setting default card'))
      callback(null, {ok: true})
    })
  })
}

function deleteCard(options, callback) {
  const {stripe, userId, cardId, StripeCustomer} = options
  if (!cardId) return callback(new Error('deleteCard requires a cardId'))

  // Check for an existing (local) stripe customer record
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    if (err) return callback(new Error(`Error retrieving customer for user ${user.id}`))
    if (!customer) return callback()

    stripe.customers.deleteCard(customer.stripeId, cardId, err => {
      if (err) return callback(new Error('Stripe error creating new card'))
      callback(null, {ok: true})
    })
  })
}

function chargeCustomer(options, callback) {
  const {stripe, userId, amount, currency, StripeCustomer} = options
  if (!amount) return callback(new Error('chargeCustomer requires an amount'))
  if (!currency) return callback(new Error('chargeCustomer requires a currency'))

  // Check for an existing (local) stripe customer record
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    if (err) return callback(new Error(`Error retrieving customer for user ${user.id}`))
    if (!customer) return callback()

    stripe.charges.create({
      amount,
      currency,
      customer: customer.stripeId,
    }, err => {
      if (err) return callback(new Error('Stripe error charging customer'))
      return callback(null, {ok: true})
    })
  })
}

function listPlans(options, callback) {
  options.stripe.plans.list((err, json) => {
    if (err) return callback(new Error('Stripe error retrieving plans'))
    callback(null, json.data)
  })
}

function showSubscription(options, callback) {
  const {stripe, userId, StripeCustomer} = options

  // Check for an existing (local) stripe customer record
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    if (err) return callback(new Error(`Error retrieving customer for user ${user.id}`))
    if (!customer) return callback()

    stripe.subscriptions.retrieve(customer.subscriptionId, callback)
  })
}

function subscribeToPlan(options, callback) {
  const {stripe, userId, planId, StripeCustomer} = options

  // Check for an existing (local) stripe customer record
  console.log('finding cust', {user_id: userId})
  StripeCustomer.cursor({user_id: userId, $one: true}).toJSON((err, customer) => {
    console.log('got cust', err, customer)
    if (err) return callback(new Error(`Error retrieving customer for user ${user.id}`))
    if (!customer) return callback()

    let subscription
    const queue = new Queue(1)

    queue.defer(callback => {
      console.log('subscriptions.create')
      stripe.subscriptions.create({customer: customer.stripeId, plan: planId}, (err, _subscription) => {
        console.log('subscriptions.create done', err, _subscription)
        if (err) return callback(new Error('Stripe error subscribing to plan'))
        subscription = _subscription
        callback()
      })
    })

    queue.defer(callback => {
      customer.subscriptionId = subscription.id
      const cust = new StripeCustomer(customer)
      cust.save(callback)
    })

    if (options.onSubscribe) queue.defer(callback => options.onSubscribe({userId, subscription}, callback))

    queue.await(err => {
      console.log('subbed', subscription)
      if (err) return callback(err)
      callback(null, subscription)
    })
  })
}

export {
  createCard,
  listCards,
  deleteCard,
  setDefaultCard,
  chargeCustomer,
  listPlans,
  showSubscription,
  subscribeToPlan,
}
