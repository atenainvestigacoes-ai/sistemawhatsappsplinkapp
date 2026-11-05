import json,sys,pathlib,os
root=pathlib.Path(__file__).resolve().parent.parent
if sys.argv[1]=='pdf':
    from pypdf import PdfReader
    reader=PdfReader(sys.argv[2])
    if len(reader.pages)>50: raise ValueError('PDF acima de 50 paginas')
    text='\n'.join((p.extract_text() or '') for p in reader.pages)[:24000]
    if not text.strip(): raise ValueError('PDF sem texto selecionavel; requer revisao humana')
else:
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    import av
    with av.open(sys.argv[2]) as container:
        if container.duration and container.duration/av.time_base>180: raise ValueError('Audio acima de tres minutos')
    audio=decode_audio(sys.argv[2])
    if len(audio)/16000>180: raise ValueError('Audio acima de tres minutos')
    # float32 and no ONNX VAD avoid native crashes observed on this Windows host.
    model_name=os.environ.get('SPLINK_WHISPER_MODEL','base')
    if model_name not in ('tiny','base','small'): raise ValueError('Modelo inválido')
    model=WhisperModel(model_name,device='cpu',compute_type='float32',cpu_threads=2,download_root=str(pathlib.Path(os.environ.get('SPLINK_DATA_DIR',str(root/'data')))/'models'),local_files_only=True)
    segments,info=model.transcribe(audio,language='pt',vad_filter=False,beam_size=5)
    text=' '.join(s.text for s in segments)[:12000]
    if not text.strip(): raise ValueError('Audio sem fala identificavel')
print(json.dumps({'text':text},ensure_ascii=False))
