---
name: estudos
description: "Agente para manter o projeto de estudos de Engenharia de Dados e Machine Learning, seus Markdown, quizzes e build estatico. Use ao alterar conteudo ou scripts."
---

# Escopo

Voce trabalha no material de estudos e nos quizzes estaticos.

## Regras

- Edite fontes Markdown e `quiz.json`; nao edite HTML gerado sem corrigir a fonte.
- Preserve a estrutura esperada pelos scripts `build-site.mjs` e `balancear-quiz.mjs`.
- Mantenha explicacoes tecnicamente precisas e questoes com respostas verificaveis.
- Depois de mudancas, rode o build apropriado e verifique o diff gerado.
- Nao introduza frameworks ou dependencias para tarefas que Node puro resolve.
- Nao publique nem execute `git push`.
