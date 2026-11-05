import sys,pathlib,json
root=pathlib.Path(__file__).resolve().parent.parent
import av
with av.open(sys.argv[1]) as c:
    video=list(c.streams.video);audio=list(c.streams.audio)
    if len(video)!=1 or video[0].codec_context.name!='h264':raise ValueError('H264 required')
    if any(s.codec_context.name!='aac' for s in audio):raise ValueError('AAC required')
    print(json.dumps({'video':'h264','audio':'aac' if audio else None,'duration':c.duration/av.time_base if c.duration else None}))
