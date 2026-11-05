import sys,pathlib,json,base64,io,csv,re,hashlib,zipfile
sys.stdout.reconfigure(encoding='utf-8')
root=pathlib.Path(__file__).resolve().parent.parent
def norm(x):
    import unicodedata
    return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',str(x or '')).encode('ascii','ignore').decode().lower())
def number(x,label,row):
    if x is None or str(x).strip().lower() in ('','-','sob consulta','consultar','não informado','nao informado'):return None
    if isinstance(x,bool):raise ValueError(f'{label} inválido na linha {row}')
    if isinstance(x,(float,int)):v=float(x)
    else:
        s=re.sub(r'R\$|\s','',str(x),flags=re.I)
        if ',' in s:s=s.replace('.','').replace(',','.')
        elif re.fullmatch(r'\d{1,3}(?:\.\d{3})+',s):s=s.replace('.','')
        try:v=float(s)
        except:raise ValueError(f'{label} inválido na linha {row}')
    import math
    if not math.isfinite(v) or (v<0 and label!='Estoque'):raise ValueError(f'{label} negativo ou inválido na linha {row}')
    return round(v,2)
def parse(request):
    name=pathlib.Path(str(request.get('name',''))).name
    raw=base64.b64decode(request['base64'],validate=True)
    if not raw or len(raw)>5*1024*1024:raise ValueError('Planilha deve ter até 5 MB')
    ext=pathlib.Path(name).suffix.lower();sheets=[];sheet='CSV'
    if ext=='.xlsx':
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if sum(i.file_size for i in z.infolist())>50*1024*1024:raise ValueError('Planilha descompactada acima de 50 MB')
        from openpyxl import load_workbook
        wb=load_workbook(io.BytesIO(raw),read_only=True,data_only=True,keep_links=False)
        sheets=wb.sheetnames;sheet=request.get('sheet') or sheets[0]
        if sheet not in sheets:raise ValueError('Aba não encontrada')
        ws=wb[sheet]
        if ws.max_row>10001 or ws.max_column>100:raise ValueError('Limite: 10000 produtos e 100 colunas')
        rows=list(ws.iter_rows(values_only=True));wb.close()
    elif ext in ('.csv','.tsv'):
        try:text=raw.decode('utf-8-sig')
        except UnicodeDecodeError:text=raw.decode('cp1252')
        delimiter='\t' if ext=='.tsv' else ';' if text.splitlines()[0].count(';')>text.splitlines()[0].count(',') else ','
        rows=list(csv.reader(io.StringIO(text),delimiter=delimiter))
        if len(rows)>10001 or any(len(r)>100 for r in rows):raise ValueError('Limite: 10000 produtos e 100 colunas')
    else:raise ValueError('Use XLSX, CSV ou TSV. Para XLS antigo, salve como XLSX.')
    if not rows:raise ValueError('Planilha vazia')
    headers=[str(h or '').strip() for h in rows[0]];normalized=[norm(h) for h in headers]
    aliases={'sku':['sku','codigo','codigoproduto','referencia','id'],'nome':['nome','produto','name','nomeproduto','titulo','descricao'],'preco':['preco','precovenda','valor','price','valorunitario'],'estoque':['estoque','quantidade','saldo','stock','qtd'],'descricao':['descricaocomplementar','descricaocurta','description','detalhes','descricao'],'categoria':['categoriadoproduto','categoria','category','grupodeprodutos'],'link':['linkexterno','link','url','linkproduto']}
    idx={k:next((normalized.index(alias) for alias in v if alias in normalized),None) for k,v in aliases.items()}
    if idx['nome'] is None:raise ValueError('Inclua uma coluna nome ou produto na primeira linha')
    products=[];seen=set();generated=0
    for line,row in enumerate(rows[1:],2):
        if not any(x is not None and str(x).strip() for x in row):continue
        def cell(key):
            i=idx[key];return row[i] if i is not None and i<len(row) else None
        pname=str(cell('nome') or '').strip()
        if not pname:raise ValueError(f'Produto sem nome na linha {line}')
        public_attrs={'marca','modelo','cor','tamanho','unidade','unidadedemedida','condicaodoproduto','mesesgarantianofornecedor'}
        attrs={headers[i]:str(v).strip()[:200] for i,v in enumerate(row[:len(headers)]) if v is not None and str(v).strip() and normalized[i] in public_attrs}
        sku=str(cell('sku') or '').strip()
        if not sku:
            sku='AUTO-'+hashlib.sha256((norm(pname)+json.dumps(attrs,sort_keys=True)).encode()).hexdigest()[:16];generated+=1
        if len(sku)>120:raise ValueError(f'SKU acima de 120 caracteres na linha {line}')
        if sku.lower() in seen:raise ValueError(f'SKU duplicado na linha {line}: {sku}')
        seen.add(sku.lower())
        link=str(cell('link') or '').strip()[:1000]
        if link and not re.match(r'^https?://',link,re.I):raise ValueError(f'Link inválido na linha {line}; use http ou https')
        state_idx=next((i for i,h in enumerate(normalized) if h in ['situacao','status','ativo']),None)
        active=state_idx is None or norm(row[state_idx] if state_idx<len(row) else '') not in ['inativo','inativa','nao','false','0','desativado']
        import html
        description=html.unescape(re.sub('<[^>]+>',' ',str(cell('descricao') or '')))
        products.append({'sku':sku[:120],'nome':pname[:250],'preco':number(cell('preco'),'Preço',line),'estoque':number(cell('estoque'),'Estoque',line),'ativo':active,'descricao':re.sub(r'\s+',' ',description)[:1000],'categoria':str(cell('categoria') or '')[:200],'link':link,'atributos':attrs})
    if not products:raise ValueError('Nenhum produto encontrado')
    return {'products':products,'source':name,'sheets':sheets,'sheet':sheet,'generatedSkus':generated,'headers':headers}
try:print(json.dumps(parse(json.load(sys.stdin)),ensure_ascii=False))
except Exception as e:print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(1)
