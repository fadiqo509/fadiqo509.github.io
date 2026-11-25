(function(){let e=null;async function t(e,t){let n=await import(`${e}pyodide.mjs`),[r,i]=await Promise.all([n.loadPyodide({indexURL:e}),fetch(t).then(e=>{if(!e.ok)throw Error(`bundle`);return e.json()})]);for(let[e,t]of Object.entries(i)){let n=`/app/${e}`;r.FS.mkdirTree(n.slice(0,n.lastIndexOf(`/`))),r.FS.writeFile(n,t,{encoding:`utf8`})}return await r.runPythonAsync(`
import asyncio, json, sys, traceback
sys.path.insert(0, '/app')

# No threads in the browser: the bot thinks where it is (this is a worker, so the page does not wait).
async def _to_thread(fn, *args, **kwargs):
    return fn(*args, **kwargs)
asyncio.to_thread = _to_thread

from webapp import rooms

async def shahd_room(me_json, action, body_json):
    me = json.loads(me_json)
    body = json.loads(body_json)
    try:
        out = await rooms.handle(me, action, body)
    except rooms.RoomError as err:
        return json.dumps({"ok": False, "error": err.code, "status": err.status})
    except Exception:
        traceback.print_exc()
        return json.dumps({"ok": False, "error": "failed", "status": 500})
    return json.dumps(out, ensure_ascii=False)
`),r}self.onmessage=async n=>{let{id:r,kind:i}=n.data;try{if(i===`start`){e||(e=t(n.data.pyodide,n.data.bundle)),await e,self.postMessage({id:r,out:`{"ok":true}`});return}if(!e)throw Error(`not started`);let a=await(await e).globals.get(`shahd_room`)(JSON.stringify(n.data.me),String(n.data.action),JSON.stringify(n.data.body||{}));self.postMessage({id:r,out:String(a)})}catch(t){i===`start`&&(e=null),self.postMessage({id:r,fail:String(t?.message||t)})}}})();