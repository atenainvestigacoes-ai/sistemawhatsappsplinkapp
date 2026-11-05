# Splink App — WhatsApp local com Codex

Atendimento, CRM, catálogo, pedidos e campanhas consentidas, executados no seu computador.

**Criador: Marco Matias** · [Instagram @splink.app](https://www.instagram.com/splink.app/) · [www.splinkapp.com.br](https://www.splinkapp.com.br)

Este repositório contém a versão pública do sistema. Não inclui sessões de WhatsApp, clientes, conversas, catálogos comerciais, chaves ou credenciais de terceiros. Cada instalação cria seu próprio banco e código de acesso. O código é MIT; serviços externos, consumo de IA e requisitos das contas não estão incluídos.

## O que faz

- Pareamento por QR code e atendimento individual em modo pausado, supervisionado ou automático.
- Contexto local de conversas, nome/cidade, resumo por cliente e CRM simples.
- Catálogo CSV/TSV/XLSX, pesquisa por nomes aproximados, menus e fotos por SKU.
- Áudio transcrito localmente; PDFs com texto; imagens analisadas pelo Codex.
- Carrinho com preço calculado pelo servidor, dados do comprador e confirmação após resumo.
- Encaminhamento para humano e avisos para números internos configurados por você.
- Campanhas com texto, imagem, vídeo ou documentos, consentimento, intervalo, pausa/cancelamento e relatório CSV.
- MCP opcional para consultar conversas, preparar respostas e enviar somente rascunhos aprovados.

## Requisitos

- Node.js **24 LTS** e npm. Windows é o ambiente principal; o CI também testa Linux.
- [Codex CLI oficial](https://github.com/openai/codex), atualizado e autenticado na sua conta. Execute `codex login` e verifique `codex login status`. O diagnóstico verifica as opções necessárias; versões incompatíveis não devem ser usadas.
- Python 3.11 ou 3.12 para catálogo e mídia; ambiente virtual recomendado. Textos e CRM não precisam das bibliotecas de mídia.
- WhatsApp próprio para parear e internet. O computador deve continuar ligado e sem suspender.

O projeto não usa OpenRouter e não distribui acesso ao ChatGPT. A IA usa os limites, permissões e custos da conta do operador. Conteúdo enviado ao Codex é processado pela OpenAI: avise seus clientes e configure sua política de privacidade.

## Instalar

```sh
git clone https://github.com/atenainvestigacoes-ai/sistemawhatsappsplinkapp.git
cd sistemawhatsappsplinkapp
npm ci --ignore-scripts
npm run setup
```

Instale o Codex conforme a documentação oficial, por exemplo `npm install -g @openai/codex`, e faça o login na sua própria conta. O software não pede senha do ChatGPT nem copia o login de outra pessoa.

Para catálogo, áudio, PDF e validação de vídeo, crie o ambiente Python:

**Windows PowerShell:**

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip==26.3
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run download-model
```

**Linux/macOS:**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip==26.3
.venv/bin/python -m pip install -r requirements.txt
npm run download-model
```

O modelo de áudio padrão é `base`, baixado separadamente na sua instalação. O reconhecimento não é perfeito: confirme valores, medidas, nomes e pedidos ambíguos.

```sh
npm run doctor
npm start
```

Abra **http://127.0.0.1:3210**, copie o código do arquivo `data/access-token` e entre. Se o diagnóstico indicar base não preenchida, isso é esperado antes de configurar a empresa. Uma porta ocupada não deve ser liberada encerrando processos alheios: altere `SPLINK_PORT` no `.env`.

## Primeiro atendimento

1. Preencha a base no painel com produtos, condições reais, horário, entrega e pagamentos. Não coloque segredos.
2. Ajuste `.env`: `SPLINK_PAYMENT_METHODS` lista as formas realmente aceitas. O padrão é `pix`; não oferece chave PIX ou checkout automático. Reinicie após alterar `.env`.
3. Para avisos internos, edite `data/policy.json`: `staffNumbers` recebe os números autorizados com código do país, DDD e telefone, somente dígitos. Esses destinatários recebem dados de clientes/pedidos: confira antes de ativar.
4. Conecte seu WhatsApp. No celular: **Dispositivos conectados → Conectar dispositivo**, e escaneie o QR code do painel.
5. Teste no **modo supervisionado**, com outro número seu. Confira resposta e destinatário antes de aprovar e enviar.
6. Ative o automático somente após conferir a base e o catálogo. Uma resposta manual no celular pausa a IA naquela conversa; retome manualmente pelo painel quando desejar.

Preparar resposta pelo botão ou MCP **não envia**. O atendimento automático responde a novas mensagens de contatos permitidos. A sincronização de histórico depende do WhatsApp e pode vir incompleta; mensagens antigas importadas não recebem respostas retroativas.

## Catálogo, pedidos e campanhas

Veja o [guia de operação](docs/OPERACAO.md). Há um [CSV mínimo de exemplo](examples/catalogo.csv), com itens fictícios. Importação pelo painel atualiza por SKU e preserva produtos não presentes no arquivo. Não sincroniza automaticamente com Bling, Mercado Livre ou Shopee.

Campanhas exigem consentimento confirmado, prévia e início explícito. Um intervalo não torna spam permitido nem garante proteção contra bloqueio. Responder **SAIR** bloqueia novas mensagens para aquele contato. Integração **não oficial** via Baileys: não há garantia de continuidade ou de ausência de bloqueios. Para operações que exigem suporte oficial, avalie a API oficial do WhatsApp.

## Segurança e privacidade

O servidor escuta apenas `127.0.0.1`. **Não publique este painel na Vercel, internet, túnel ou proxy reverso.** Ele é uma aplicação local de operador único, não um serviço multiusuário.

Banco SQLite, sessões, mídia, relatórios e logs locais contêm dados pessoais e não são criptografados pelo projeto. Use conta protegida do sistema operacional e disco criptografado. Não compartilhe `data/`, `.env`, código de acesso ou QR code. Faça backups protegidos com o serviço parado e siga a retenção definida pela sua empresa. Veja [SECURITY.md](SECURITY.md) e [a revisão técnica](docs/REVISAO-SEGURANCA.md).

Pedidos só registram **aguardando pagamento**; não geram boleto, não cobram, não reservam estoque e não despacham. Não validam CPF/CNPJ em órgão oficial nem consultam CEP. Campos ambíguos devem ser conferidos por humano.

## MCP, atualização e testes

O [guia MCP](docs/MCP.md) explica o acesso local. Para atualizar: faça backup, pare sua instalação, atualize o código, rode `npm ci --ignore-scripts`, revise as notas e execute os testes. Não copie dados de outra instalação.

```sh
npm test
npm run check-release
```

Não há conta compartilhada nem atualização automática da instalação original. O projeto público foi preparado em cópia separada.
