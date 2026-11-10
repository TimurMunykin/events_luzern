// Live money is allowed only in the explicitly configured production environment.
exports.config=function() {
  var mode=$os.getenv('STRIPE_MODE') || 'test', production=$os.getenv('APP_ENV')==='production';
  var key=$os.getenv('STRIPE_SECRET_KEY'), origin=$os.getenv('CHECKOUT_ORIGIN').replace(/\/$/,'');
  var live=mode==='live', secret=$os.getenv('STRIPE_WEBHOOK_SECRET'), owner=$os.getenv('CHECKOUT_NOTIFY_TO');
  if($os.getenv('CHECKOUT_ENABLED')!=='true' || ['test','live'].indexOf(mode)<0 || live!==production ||
    !(new RegExp('^(sk|rk)_'+mode+'_')).test(key) || !/^https?:\/\/[^\s/?#]+$/.test(origin) ||
    (live && (!/^https:\/\//.test(origin) || !/^whsec_\S+$/.test(secret) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)))) {
    throw new ApiError(503,'Checkout unavailable');
  }
  return {key:key,origin:origin,live:live,owner:owner};
};
exports.assertMode=function(object) {
  if(!object || object.livemode!==exports.config().live)throw new ApiError(502,'Unexpected payment mode');
};
exports.sessionId=function(id) {
  return (new RegExp('^cs_'+(exports.config().live?'live':'test')+'_[a-zA-Z0-9]+$')).test(String(id || ''));
};
