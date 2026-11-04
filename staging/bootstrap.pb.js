// Mounted only by staging/compose.yml, never included in the production image.
onBootstrap(function(e) {
  e.next();
  var settings=e.app.settings();
  settings.smtp.enabled=true;
  settings.smtp.host='mailpit'; settings.smtp.port=1025;
  settings.smtp.username=''; settings.smtp.password=''; settings.smtp.tls=false;
  settings.meta.appName='Events.Luzern'; settings.meta.appURL=$os.getenv('CHECKOUT_ORIGIN');
  settings.meta.senderName='Events.Luzern'; settings.meta.senderAddress='test@events-luzern.ch';
  e.app.save(settings);
  var adminEmail=$os.getenv('STAGING_ADMIN_EMAIL');
  var adminPassword=$os.getenv('STAGING_ADMIN_PASSWORD');
  if(!adminEmail || !adminPassword || adminPassword.length<16) throw new Error('Set isolated staging admin credentials');
  var admins=e.app.findRecordsByFilter('_superusers','email = {:email}','',1,0,{email:adminEmail});
  if(!admins.length) {
    var admin=new Record(e.app.findCollectionByNameOrId('_superusers'));
    admin.set('email',adminEmail);admin.setPassword(adminPassword);e.app.save(admin);
  }
  var password=$os.getenv('TICKET_STAFF_PASSWORD');
  if(!password || password.length<16) throw new Error('Set an isolated staff password');
  // On a fresh database the migration below provisions the account after bootstrap.
  try {e.app.findCollectionByNameOrId('ticket_staff');} catch (_) {return;}
  var existing=e.app.findRecordsByFilter('ticket_staff','username = "natali"','',1,0);
  if(!existing.length) {
    var staff=new Record(e.app.findCollectionByNameOrId('ticket_staff'));
    staff.set('username','natali');staff.set('name','Натали');staff.set('email','natali@events-luzern.test');
    staff.setPassword(password);e.app.save(staff);
  }
});
