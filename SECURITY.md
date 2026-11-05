# Segurança

Para reportar um problema, entre em contato pelos canais de Marco Matias em [splinkapp.com.br](https://www.splinkapp.com.br) ou [@splink.app](https://www.instagram.com/splink.app/). Não publique tokens, conversas, CPFs, números de clientes nem arquivos de sessão em issues.

## Modelo de confiança

Aplicação local, um operador, uma conta por processo. Não projetada para exposição pública ou computadores compartilhados sem isolamento de contas do sistema operacional. Use Node 24 LTS, dependências travadas e sistema atualizado.

## Proteções

- Bind apenas em loopback, checagem de Host/Origin, autenticação por segredo aleatório local e cookie HttpOnly/SameSite.
- Dez falhas de login por minuto bloqueiam novas tentativas temporariamente. Isso não substitui proteção do computador.
- Ações de configuração e aprovação exigem sessão do painel; MCP não pode aprovar envios.
- Preparação manual de resposta não agenda envio automático.
- Isolamento por conta e validação de destinatário/estado no momento de enviar; deduplicação e estado incerto sem reenvio automático cego.
- Consultas SQL parametrizadas, limites de upload, assinatura de formatos e hash dos anexos.
- Conteúdo do cliente exibido como texto; CSP restringe scripts e enquadramento.
- Codex sem ferramentas de shell/browser/MCP no agente de atendimento, ambiente efêmero e resposta estruturada. Isso reduz superfície, mas não elimina alucinações ou todos os efeitos de prompt injection.

## Dados e limites

Dados pessoais, arquivos e sessão ficam no diretório local, sem criptografia própria. Processamento de IA transmite contexto da conversa e eventualmente imagem à OpenAI. Áudio é transcrito localmente; o texto transcrito pode ser enviado à IA. O transporte usa WhatsApp/Baileys e pode sofrer mudanças ou bloqueios.

PDFs e codecs são processados por bibliotecas de terceiros. Limites e timeout não equivalem a sandbox de mídia. Execute com usuário comum, não administrador, e não exponha o serviço por túnel/proxy. Não há auditoria externa, certificação, pentest formal nem promessa de “à prova de erros”.

Nunca inclua em Git/ZIP: `data`, `.env`, `.venv`, `runtime.json`, bancos, sessão, logs, mídia, relatórios e backups. O script de verificação de release só aprova a lista permitida de código/documentação; revise antes de publicar.
