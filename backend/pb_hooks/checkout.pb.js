// Disabled by default. Staging explicitly opts in, and refuses live Stripe keys.
routerAdd('POST', '/api/events/checkout', function(e) {
  return require(__hooks + '/checkout.js').create(e);
}, $apis.bodyLimit(131072));
routerAdd('GET', '/api/events/checkout/{key}', function(e) {
  return require(__hooks + '/checkout.js').status(e);
});
routerAdd('POST', '/api/events/stripe-webhook', function(e) {
  return require(__hooks + '/checkout.js').webhook(e);
}, $apis.bodyLimit(262144));
cronAdd('checkout-receipts', '* * * * *', function() {
  if ($os.getenv('CHECKOUT_ENABLED') === 'true') require(__hooks + '/checkout.js').receipts();
});

routerAdd('GET','/api/events/availability/{slug}',function(e){return require(__hooks+'/checkout.js').availability(e);});
