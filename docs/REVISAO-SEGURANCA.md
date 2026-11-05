# Revisão da versão pública — 05/11/2026

Escopo: cópia de código, interface, testes, dependências e documentação. A instalação de origem não foi alterada, reiniciada nem desconectada para preparar esta versão.

## Alterações verificadas

- Configuração deixou de depender de caminhos pessoais e runtime.json. Cada instalação escolhe porta/diretório e cria segredo próprio.
- Removidos o link/número comercial do catálogo e regras geográficas da empresa de origem. Link público e pagamentos são configuráveis por instalação; dados reais não acompanham os exemplos.
- Preparar resposta no painel ou MCP não agenda envio automático, mesmo em modo auto. Uma conversa automática continua seguindo o modo escolhido pelo operador.
- Limite de dez falhas de login por minuto; Host/Origin, cookie e separação de ações do painel preservados.
- Números internos/equipe e a própria conta não entram em campanhas; há rechecagem antes de enviar.
- Exportação CSV protege valores iniciados por fórmulas, inclusive com espaço inicial.
- Python usa ambiente virtual da própria cópia. Setuptools e CTranslate2 foram atualizados; documentação atualiza o pip do ambiente antes de instalar.
- Release e ZIP são montados por lista permitida. Não copiam diretórios ignorados, mesmo se existirem no ambiente de teste.

## Evidências

78 testes automatizados passaram no ambiente Windows de preparação, incluindo HTTP, conta/consentimento, anexos, fila, estado incerto, contexto, menus, pedido/CEP/cadastro e preparação sem envio. Os novos casos de preparação manual, carrinho vazio herdado e login limitado têm regressões verificadas. O CI está configurado para Windows/Linux, mas resultados remotos devem ser conferidos na aba Actions.

`npm ci --ignore-scripts` executado na cópia; `npm audit --omit=dev` informou zero vulnerabilidades conhecidas. Python 3.12 instalado em ambiente virtual separado; pip-audit após atualizações informou zero vulnerabilidades conhecidas no ambiente analisado. Auditorias são fotografias das bases disponíveis, não garantia de ausência de falhas futuras.

Diagnóstico confirmou Node24, Codex instalado com opções exigidas/login disponível, Python e bibliotecas de mídia. Base vazia foi corretamente marcada como pendente. Teste HTTP isolado usa porta 3211 e dados temporários separados, sem parear WhatsApp nem enviar mensagens reais.

Revisão estática separada identificou um link comercial herdado, corrigido antes da publicação. Nova leitura de runtime/config/engine/server/catalog não identificou bloqueador concreto. Não houve pentest externo, análise de todos os componentes nativos ou teste real de WhatsApp nesta cópia: pareamento e operações externas devem ser validados por cada operador com sua conta.

## Limitações remanescentes

Operador único local. Dados e sessão não criptografados pelo projeto; qualquer processo autorizado a ler a conta local pode acessá-los. Mídia não é processada em sandbox nativa. Codex pode errar e transmite contexto à OpenAI. Baileys é não oficial. Não se promete ausência de bloqueio, entrega, leitura, resposta perfeita ou conformidade automática. Veja SECURITY.md.
