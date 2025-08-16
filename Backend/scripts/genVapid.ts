import webpush from 'web-push';
const keys = webpush.generateVAPIDKeys();
console.log('\nVAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey + '\n');
console.log('Paste these into your backend env and also expose PUBLIC key to the frontend.');
