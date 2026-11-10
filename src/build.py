import sys, json
import os
sd=os.path.dirname(os.path.abspath(__file__))+'/'
def build(config, out):
    bank=open(sd+'bank.js').read().replace('const TOPICS = [','const SEED_TOPICS = [').replace('const QUESTIONS = [','const SEED_QUESTIONS = [')
    bank15=open(sd+'bank15.js').read()
    app=open(sd+'app2.js').read()
    if config: app=app.replace('const FIREBASE_CONFIG = null;','const FIREBASE_CONFIG = '+json.dumps(config, indent=2)+';')
    css=open(sd+'style.css').read()+open(sd+'extra.css').read()
    html=f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Science Quest</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>{css}</style>
</head>
<body>
<div id="app"></div>
<script>
/* ================= Seed question bank (Stage 6) =================
   Each question: id, topic, type ('mcq' | 'tf' | 'fill'), q, options (mcq), answer
   (mcq: option index, tf: true/false, fill: list of accepted answers), explanation. */
{bank}
{bank15}
{app}
</script>
</body>
</html>
'''
    open(out,'w').write(html)
if __name__=='__main__':
    cfg=json.loads(sys.argv[2]) if len(sys.argv)>2 and sys.argv[2] else None
    build(cfg, sys.argv[1])
