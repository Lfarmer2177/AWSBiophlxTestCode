// src/amplify.js
import { Amplify } from 'aws-amplify';
import awsmobile from './aws-exports';

Amplify.configure(awsmobile);

console.log("✅ Amplify Auth Configured:", Amplify);
