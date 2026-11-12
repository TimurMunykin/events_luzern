routerAdd('GET','/api/events/tickets/{token}',function(e){return require(__hooks+'/tickets.js').view(e);});
routerAdd('GET','/api/events/tickets/{token}/qr.gif',function(e){return require(__hooks+'/tickets.js').qr(e);});
routerAdd('GET','/api/events/tickets/{token}/ticket.pdf',function(e){return require(__hooks+'/tickets.js').pdf(e);});
routerAdd('GET','/api/events/tickets/{token}/calendar.ics',function(e){return require(__hooks+'/tickets.js').calendar(e);});
routerAdd('GET','/api/events/staff/events',function(e){return require(__hooks+'/tickets.js').events(e);});
routerAdd('PUT','/api/events/staff/events/{id}',function(e){return require(__hooks+'/tickets.js').updateEvent(e);},$apis.bodyLimit(98304));
routerAdd('GET','/api/events/staff/tickets',function(e){return require(__hooks+'/tickets.js').list(e);});
routerAdd('POST','/api/events/staff/check-in',function(e){return require(__hooks+'/tickets.js').checkIn(e);},$apis.bodyLimit(4096));
routerAdd('POST','/api/events/staff/undo-check-in',function(e){return require(__hooks+'/tickets.js').undoCheckIn(e);},$apis.bodyLimit(4096));

routerAdd('GET','/api/events/staff/guests.csv',function(e){return require(__hooks+'/tickets.js').csv(e);});
routerAdd('POST','/api/events/staff/reminder-preview',function(e){return require(__hooks+'/tickets.js').previewReminder(e);},$apis.bodyLimit(4096));
routerAdd('GET','/api/events/staff/refund-options',function(e){return require(__hooks+'/tickets.js').refundOptions(e);});
routerAdd('POST','/api/events/staff/refund-ticket',function(e){return require(__hooks+'/tickets.js').refundTicket(e);},$apis.bodyLimit(4096));
routerAdd('POST','/api/events/staff/import-guests',function(e){return require(__hooks+'/tickets.js').importOffline(e);},$apis.bodyLimit(1048576));
routerAdd('POST','/api/events/staff/confirm-offline-payment',function(e){return require(__hooks+'/tickets.js').confirmOfflinePayment(e);},$apis.bodyLimit(4096));
