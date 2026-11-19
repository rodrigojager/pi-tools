# Alterações da cópia de Rodrigo

## 1.7.5-rodrigo.3 — 2026-10-02

Base anterior: `76f1f8b0481c1837ba80825696dba469231e3ceb`, versão 1.7.5-rodrigo.2
do fork de [pi-sidebar-tui](https://github.com/rodrigojager/pi-sidebar-tui).
O fork preserva o histórico e a licença MIT do autor original.

- `parse-todos.ts`: aceita o envelope `tasks` e os campos `subject`, `activeForm`,
  `owner` e `blockedBy` do rpiv-todo; oculta tarefas excluídas. Continua aceitando
  o formato anterior `todos` / `text` / `done`.
- `types.ts` e `panels/todos.ts`: mostram responsáveis e dependências e mantêm
  as linhas dentro da largura disponível, inclusive em terminais estreitos.
- `index.ts`: atualiza a lista em troca de ramo e compactação. Também incorpora
  a personalização Pi Goal que já estava instalada localmente: objetivo no painel,
  atividade da ferramenta atual e estados de conclusão, espera e bloqueio.
- `package.json`: versão 1.7.5-rodrigo.3; dependências de desenvolvimento Pi 1.0.0.
- Testes: snapshots antigos e novos, exclusão, atividade, responsável, dependências
  e largura de renderização. Suíte completa: **139 testes aprovados**.

O atalho da sidebar continua **Ctrl+Shift+T**. O perfil do rpiv-todo usa **Alt+T**
para evitar conflito. Os reparos anteriores do renderer e do Git assíncrono permanecem.

Instalação desta versão:

```powershell
pi install https://github.com/rodrigojager/pi-sidebar-tui@v1.7.5-rodrigo.3
```

Faça a troca de uma instalação local apenas depois de terminar o trabalho na sessão
atual; escolha uma única fonte da sidebar nas configurações para não carregar duas cópias.
