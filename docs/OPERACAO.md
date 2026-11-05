# Operação

## Cadastro e memória

O agente solicita nome/cidade e mantém histórico e resumo no SQLite local. O cadastro não deve criar carrinho vazio. O resumo gerado por IA pode conter imprecisões; confira o histórico original no painel. Não armazene senhas ou dados de cartão.

## Importar produtos

Conecte uma conta, abra Produtos e selecione CSV, TSV ou XLSX de até 5 MB. Campos mínimos: `sku` e `nome`; `preco` e `estoque` podem ficar vazios para desconhecido. O leitor também reconhece exportações Bling com `Código`, `Descrição`, `Preço` e `Estoque`. Custo e fornecedor não fazem parte do catálogo entregue ao agente.

Clique Conferir catálogo, revise os exemplos e depois Importar/atualizar. A atualização é por SKU, sem excluir produtos ausentes. SKU duplicado no arquivo é recusado. XLSX usa a primeira aba na interface; para outra aba, exporte a aba desejada como CSV. Estoque zero/negativo significa indisponível. Estoque e preço não são atualizados por venda nem reservados automaticamente.

Vincule fotos reais por SKU. Não use imagens genéricas para representar um modelo específico. Busca aproximada oferece candidatos, não comprova equivalência de marca ou medida.

## Pedido

O cliente escolhe produto e quantidade. O servidor confere SKU, estoque e preço da última importação e calcula o subtotal em centavos. Recolhe nome, CPF/CNPJ, endereço, cidade, CEP, contato, e-mail e pagamento. O contato pode ser aproveitado do WhatsApp. A conferência de CPF/CNPJ é apenas de comprimento; CEP não recebe consulta externa.

Depois do resumo efetivamente enviado, o cliente confirma expressamente. Mudança no carrinho invalida a confirmação anterior. O pedido fica aguardando pagamento e entrega e pode avisar a equipe configurada. O frete e pagamentos são concluídos fora deste sistema. Não use como ERP fiscal.

## Campanha

1. Use somente destinatários que autorizaram receber sua comunicação. Importe CSV `nome;telefone`, informando origem e consentimento, ou escolha conversas sincronizadas/lista manual.
2. Confira público, mensagem e eventual anexo. Evite dados pessoais na mensagem de campanha.
3. Escolha intervalo de 10 a 3.600 segundos. O padrão de preparação é 30 segundos; isso não constitui limite oficial do WhatsApp nem garantia contra bloqueio.
4. Prepare a prévia. Contatos pausados/cancelados são excluídos; a consulta externa valida números e só corrige nono dígito após confirmação pelo WhatsApp. A verificação tem limite de tempo: confira os excluídos.
5. Inicie explicitamente. Acompanhe contagens, pause/cancele e baixe o relatório ao terminar.

“Enviado” é o registro de sucesso do transporte, não comprovante de entrega/leitura. “Incerto” exige conferir no celular antes de qualquer reenvio. Ao reiniciar o serviço, campanhas em execução ficam pausadas para revisão. Fila e respostas compartilham intervalo global, então novos atendimentos podem aumentar o tempo de campanha.

Os dois destinatários de aviso são exemplos de configuração: a versão pública não tem números internos predefinidos. Nunca use listas compradas ou dados extraídos sem autorização.

## Backup e restauração

Pare o serviço antes de copiar o diretório de dados completo, incluindo SQLite e arquivos auxiliares, mídia e sessão. Guarde backup cifrado e restrito. Restaurar uma cópia de sessão em dois computadores ao mesmo tempo pode causar conflitos. Backup não substitui retenção e exclusão de dados conforme sua política.

Para encerrar em primeiro plano, use Ctrl+C. `npm run background` inicia o processo sem janela; para uma operação simples, prefira primeiro plano. Fechar o navegador não encerra o serviço. Não suspenda o computador enquanto precisar do atendimento.

## Problemas comuns

- QR code ausente: confira internet e sessão. Novo pareamento arquiva a sessão anterior; desconecte antes.
- Agente silencioso: confira modo, base preenchida, permissão/pausa do contato e `codex login status`.
- Áudio/PDF com erro: instale Python e requisitos, baixe o modelo e confira `npm run doctor`. PDF digitalizado sem texto exige revisão humana; não há OCR de PDF integrado.
- Pedidos de humano: veja conhecimento e catálogo; o agente não deve inventar resposta. Configure a equipe em `data/policy.json`.
- Não há suporte a múltiplos WhatsApps simultâneos no mesmo processo. Use uma instalação e porta/diretório de dados exclusivos por número.
