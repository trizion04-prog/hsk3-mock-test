#!/bin/bash
# Uploads Science Quest to Firebase Hosting and installs the database rules.
cd "$(dirname "$0")"
npx -y firebase-tools@latest deploy --only hosting,firestore:rules \
  || (npx -y firebase-tools@latest login --no-localhost && npx -y firebase-tools@latest deploy --only hosting,firestore:rules)
