#!/bin/bash
cd ~/daily-brief
node -e "
const https = require('https');
const fs = require('fs');
// Generate fresh brief and save to public/index.html
console.log('Generating daily brief...');
" && firebase deploy --only hosting
