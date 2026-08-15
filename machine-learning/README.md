# Machine Learning — Material de Estudo para Entrevistas Técnicas

Material focado em **conceitos e perguntas de entrevista**, não em código para rodar. O objetivo é que você consiga **defender** cada conceito numa conversa: explicar a intuição, justificar trade-offs, e sobreviver aos follow-ups.

---

## Como usar este material

Cada arquivo tem três seções:

1. **Resumo conceitual** — a explicação densa. Leia primeiro. Fórmulas aparecem só quando esclarecem algo; não decore.
2. **Perguntas de entrevista** — cada pergunta marcada com nível, seguida de uma resposta modelo (o que o entrevistador quer ouvir) e os follow-ups comuns.
3. **Armadilhas comuns** — os erros conceituais que derrubam candidatos.

### Níveis de dificuldade

| Marca | Nível | Quem costuma receber |
|---|---|---|
| 🟢 | **Básico** | Triagem inicial, estágio, júnior. Errar aqui é eliminatório. |
| 🟡 | **Intermediário** | Pleno / sênior. É aqui que a maioria das entrevistas mora. |
| 🔴 | **Avançado** | Sênior / staff, ou follow-up de uma resposta boa demais. Errar não elimina, acertar diferencia. |

### Como se autoavaliar (você não sabe seu nível hoje)

Faça isto por tópico, antes de ler o resumo:

1. Leia só o **enunciado** da pergunta e responda em voz alta, cronometrando ~2 minutos.
2. Só então leia a resposta modelo.
3. Marque-se: **acertei o essencial** / **sabia o nome mas não a intuição** / **não sabia**.

Regra prática de calibração:

- Se você trava em 🟢 → comece pelos arquivos 01, 02, 03, 04. Nada mais.
- Se 🟢 é confortável e 🟡 é ~50% → seu nível é pleno. O gap está em trade-offs e validação, não em algoritmos.
- Se 🟡 é confortável → foque em 🔴, em 11 (MLOps) e 12 (System Design). É o que separa sênior de pleno na prática.

**O teste real:** se você não consegue explicar o conceito sem usar o jargão, você não sabe o conceito. "Regularização L1 zera coeficientes" é jargão repetido. "L1 zera coeficientes porque o gradiente da penalidade é constante em módulo, então ele continua empurrando o peso em direção a zero mesmo quando o peso já é minúsculo — diferente de L2, cuja força some junto com o peso" é entendimento.

---

## Índice

| # | Tópico | Conteúdo |
|---|---|---|
| [01](01-fundamentos.md) | **Fundamentos** | Supervisionado / não-supervisionado / reforço, bias-variance, overfitting, regularização L1/L2, teorema No Free Lunch |
| [02](02-metricas-avaliacao.md) | **Métricas de avaliação** | Matriz de confusão, precision/recall/F1, ROC-AUC vs PR-AUC, quando cada métrica engana, métricas de regressão, calibração |
| [03](03-validacao-e-dados.md) | **Validação e dados** | Train/val/test, cross-validation e variantes, data leakage, validação temporal, desbalanceamento de classes |
| [04](04-modelos-classicos.md) | **Modelos clássicos** | Regressão linear/logística, árvores, random forest, gradient boosting (XGBoost/LightGBM/CatBoost), SVM, kNN, Naive Bayes |
| [05](05-features-e-dimensionalidade.md) | **Features e dimensionalidade** | Feature engineering, encoding de categóricas, escalonamento, missing values, curse of dimensionality, PCA, seleção de features |
| [06](06-otimizacao.md) | **Otimização** | Gradiente descendente e variantes, learning rate, funções de perda, convexidade, Adam vs SGD |
| [07](07-redes-neurais.md) | **Redes neurais** | Backpropagation, ativações, batch norm, dropout, vanishing/exploding gradients, CNNs, RNNs |
| [08](08-deep-learning-moderno.md) | **Deep learning moderno** | Transformers e atenção, embeddings, transfer learning, fine-tuning, LLMs, RAG |
| [09](09-nao-supervisionado.md) | **Não-supervisionado** | k-means, DBSCAN, hierárquico, avaliação de clusters, redução de dimensionalidade não-linear, detecção de anomalias |
| [10](10-estatistica-probabilidade.md) | **Estatística e probabilidade** | Bayes, distribuições, teste de hipótese, p-valor, intervalos de confiança, MLE/MAP |
| [11](11-mlops-producao.md) | **MLOps e produção** | Data drift vs concept drift, monitoramento, retreino, A/B testing, batch vs online serving, feature store |
| [12](12-ml-system-design.md) | **ML System Design** | O framework de resposta, recomendação, ranking, detecção de fraude, busca |

---

## Trilha sugerida de estudo

### Fase 1 — Fundação inegociável (arquivos 01, 02, 03)

Não pule. **A maioria das reprovações em entrevista de ML não é por não saber transformers — é por não saber explicar por que o AUC de 0.95 do candidato não significava nada porque havia leakage.** Estes três tópicos são os mais cobrados em qualquer nível e são os que mais aparecem disfarçados dentro de outras perguntas.

Sinal de que você terminou a fase: você consegue, de improviso, explicar por que acurácia é inútil num problema com 1% de positivos, e propor três métricas melhores justificando cada escolha pelo custo do erro.

### Fase 2 — Modelagem prática (arquivos 04, 05, 06)

O núcleo do trabalho real. O objetivo aqui não é decorar algoritmos, é conseguir responder **"por que você escolheu esse modelo?"** com algo além de "porque funciona bem". Gradient boosting e regressão logística são de longe os mais cobrados — domine esses dois profundamente antes de se preocupar com SVM.

Sinal de que você terminou: você explica a diferença entre bagging e boosting em termos de bias e variância, sem decorar a frase.

### Fase 3 — Deep learning (arquivos 07, 08)

Peso variável conforme a vaga. Para vagas de **ML tradicional / data science**, o 07 basta e o 08 é conversa cultural. Para vagas de **ML engineer / NLP / LLM**, o 08 é o centro da entrevista.

Atenção: entrevistadores de LLM adoram perguntar coisas básicas de forma nova ("por que dividimos por √d_k na atenção?"). Entenda os mecanismos, não a taxonomia de modelos.

### Fase 4 — Diferencial de sênior (arquivos 09, 10, 11, 12)

- **10 (estatística)** — cobrado pesado em vagas de data scientist e em empresas de produto (A/B testing).
- **11 (MLOps)** — o que separa quem já colocou modelo em produção de quem só treinou em notebook. Cobrado em quase toda vaga de ML engineer.
- **12 (system design)** — a rodada final da maioria dos processos sênior. Vale ler cedo mesmo se você for júnior, porque ele mostra *para que serve* tudo nos outros arquivos.
- **09 (não-supervisionado)** — menos cobrado, mas cai em vagas com segmentação de clientes ou detecção de anomalia.

### Roteiro por tempo disponível

| Tempo até a entrevista | O que fazer |
|---|---|
| **2 dias** | 01, 02, 03 completos. Só as perguntas 🟢 e 🟡 dos outros. |
| **1 semana** | Fase 1 + Fase 2 completas, 11 e 12 lidos uma vez. |
| **1 mês** | Tudo, na ordem. Refaça as perguntas dos arquivos 01–03 na última semana — é o que mais cai e o que mais se esquece. |
| **Contínuo** | Um arquivo a cada 2-3 dias, e releia os 🔴 que você errou. |

---

## Regras de ouro para a entrevista em si

**Pense em voz alta.** Entrevistador de ML avalia raciocínio, não a resposta final. Silêncio de 30 segundos é pior que um raciocínio parcialmente errado dito em voz alta.

**Pergunte antes de responder.** "Qual o custo de um falso negativo aqui?" vale mais que qualquer métrica que você escolha sozinho. Quase toda pergunta boa de ML é subespecificada de propósito.

**Comece simples e justifique a complexidade.** A resposta "eu começaria com uma regressão logística como baseline para ter um número de referência, e só iria para gradient boosting se o ganho justificasse" é sempre mais forte que "eu usaria um transformer". Ninguém é reprovado por propor um baseline; muita gente é reprovada por propor complexidade sem justificar.

**Diga "não sei" e proponha como descobriria.** "Não tenho certeza se o LightGBM faz isso por padrão, mas o jeito de verificar seria X" é uma resposta aceitável de sênior. Inventar comportamento de biblioteca é fatal, porque o entrevistador quase sempre sabe.

**Traga o negócio de volta.** Toda resposta técnica fica mais forte terminando em impacto: "...o que importa aqui é que reduzir falso positivo em 2 pontos economiza X análises manuais por dia."
