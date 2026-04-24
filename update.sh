#!/bin/bash
cd ~/daily-brief
cp ~/Downloads/FinalBrief.html ~/daily-brief/public/index.html 2>/dev/null
firebase deploy --only hosting
