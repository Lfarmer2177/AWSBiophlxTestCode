// src/amplify.js
import { Amplify } from 'aws-amplify';
import awsmobile from './aws-exports';

Amplify.configure({
  ...awsmobile,
  Storage: {
    S3: {
      bucket: 'biophlx-profile-pictures',
      region: 'us-east-2'
    }
  }
});

console.log("✅ Amplify Auth & Manual S3 Configured:", Amplify.getConfig());
