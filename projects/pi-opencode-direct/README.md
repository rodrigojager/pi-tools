# pi-opencode-direct

Plugin do Pi que atualiza automaticamente os catálogos do OpenCode Zen e Go e oferece acesso HTTP direto ao Zen gratuito. Não executa `opencode` nem depende do OpenCode CLI em runtime.

## Como funciona

O Zen valida não apenas os headers, mas também a forma da requisição produzida pelo cliente oficial. A extensão usa os engines nativos do `pi-ai`, preserva as ferramentas reais do Pi e acrescenta declarações inertes para os nomes essenciais do OpenCode que não estiverem presentes. Nenhuma ferramenta do OpenCode é executada.

Os IDs são consultados diretamente em `https://opencode.ai/zen/v1/models` e `https://opencode.ai/zen/go/v1/models`. Nomes, limites, preços, modalidades e protocolos vêm de `models.dev`; IDs ausentes dos endpoints nunca são adicionados somente por aparecerem nos metadados. Promoções marcadas como `deprecated` são excluídas, mesmo quando o endpoint ainda anuncia o ID antigo.

| Provider no Pi | Catálogo | Autenticação |
| --- | --- | --- |
| `opencode-direct` | Zen gratuito ativo | Identificador público |
| `opencode` | Zen completo ativo | Chave OpenCode |
| `opencode-go` | Go completo ativo | Chave OpenCode com acesso Go |

Os providers completos preservam a autenticação e os engines nativos do Pi, inclusive Responses, Anthropic e Google. Go usa seu próprio endpoint e catálogo.

Nas requisições autenticadas de Zen e Go, a extensão identifica o cliente como `pi-opencode-direct/0.1.0` e envia o `sessionId` da conversa em `x-opencode-session`, inclusive com providers nativos antigos. Cabeçalhos explícitos do chamador são preservados. Isso segue os [requisitos de clientes do Go](https://opencode.ai/v2/docs/console/go/#where-can-i-use-it); não altera restrições do serviço gratuito.

Se um modelo novo usa um protocolo ausente do catálogo nativo antigo, a extensão encaminha a requisição ao engine nativo correspondente do Pi. Isso inclui modelos Google no Go.

### Atualização automática

- Consulta ao carregar a extensão, antes da seleção inicial do modelo.
- Persistência automática no início da sessão e nova consulta a cada **5 minutos**, sem comandos ou tentativa prévia de usar um modelo.
- Verificação de atualização ao retornar de uma suspensão ou longa inatividade.
- Requisições simultâneas compartilham uma consulta aos dois endpoints e aos metadados.
- Consulta bem-sucedida substitui a lista inteira, removendo IDs retirados. Uma lista vazia válida também substitui o cache.
- Erros, respostas inválidas e cancelamentos preservam o último catálogo válido. A próxima tentativa é automática.
- `PI_OFFLINE` desativa as consultas; o último snapshot permanece disponível.

A consulta inicial tem prazo de 5 segundos. Modelos desconhecidos recebem limites conservadores; metadados conhecidos do Pi continuam disponíveis quando a fonte de metadados falha. A lista informa o catálogo publicado pelo serviço; não garante crédito, assinatura ou disponibilidade instantânea de inferência.

## Instalação

```bash
pi install https://github.com/rodrigojager/pi-opencode-direct
```

Depois de instalar ou alterar o plugin, execute `/reload` uma vez ou reinicie o Pi. A partir daí os catálogos se atualizam sozinhos.

Para autenticar os providers completos, use `/login opencode` ou `/login opencode-go` no Pi, ou configure `OPENCODE_API_KEY`. O Pi mostra em `/model` os modelos dos providers autenticados. Exemplos de IDs: `opencode-go/deepseek-v4.1-flash` e `opencode/deepseek-v4-flash`; os IDs efetivos sempre vêm do catálogo atual.

## Fallback recomendado

A validação do Zen pode mudar. Mantenha também `https://github.com/rodrigojager/opencode-pi`, que delega ao CLI oficial e é mais resiliente a mudanças futuras.

O serviço pode recusar inferência gratuita fora do OpenCode com `FreeTierError`, mesmo anunciando o modelo em `/models`. Atualizar o catálogo não altera essa restrição; Zen autenticado e Go usam os providers nativos do Pi.

## Segurança

- Não lê credenciais de outras extensões.
- O Zen gratuito usa apenas o identificador público. Zen completo e Go usam a autenticação nativa configurada pelo usuário no Pi.
- Não inicia subprocessos.
- Ferramentas inexistentes continuam sujeitas ao allowlist normal do Pi.

## Desenvolvimento

```bash
npm install
npm run build
npm test
bun scripts/verify-catalogs.ts
```

Licença GPL-3.0-or-later. Baseado em `pi-opencode-free` de Pedro Alexis.
