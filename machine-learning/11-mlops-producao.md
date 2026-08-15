# 11 — MLOps e ML em Produção

> Drift de dados e de conceito, monitoramento, retreino, A/B testing de modelos, serving batch vs online, feature store.
> Este é o tópico que separa quem já colocou modelo em produção de quem só treinou em notebook. É cobrado em praticamente toda vaga de ML Engineer, e a resposta certa quase nunca é sobre modelagem.

---

## 1. Resumo conceitual

### 1.1 A premissa que muda tudo

Em pesquisa, o modelo é o produto. Em produção, **o modelo é um componente pequeno de um sistema que envolve ingestão, transformação, serving, monitoramento e feedback**. A literatura de engenharia de ML enfatiza há anos que o código de ML é uma fração minúscula do sistema; o resto é infraestrutura, dados e operação.

Três consequências que orientam qualquer resposta boa neste tópico:

1. **Modelos degradam sozinhos.** Diferente de software determinístico, um modelo piora com o tempo mesmo sem ninguém mexer nele, porque o mundo muda. Um sistema de ML sem monitoramento está falhando silenciosamente agora e você não sabe.
2. **A maioria dos incidentes de ML em produção é de dados, não de modelo.** Um upstream mudou o formato de um campo, um job atrasou, uma unidade mudou de centavos para reais. O modelo continua rodando e produzindo números — errados, silenciosamente.
3. **Simplicidade tem valor operacional real.** Um modelo 1% pior mas 10× mais simples de operar é frequentemente a escolha certa.

### 1.2 Drift

**Data drift (covariate shift)** — `P(X)` muda, `P(y|X)` permanece. A distribuição das entradas mudou, mas a relação aprendida continua válida. Exemplo: sua base de usuários passou a ser mais jovem; a relação entre comportamento e churn não mudou, mas você está operando numa região do espaço de features com menos dados de treino. Efeito: degradação moderada, pior nas regiões novas.

**Concept drift** — `P(y|X)` muda. **A relação em si mudou** e o modelo está errado, não apenas extrapolando. Exemplo: fraudadores adotam uma nova técnica; a mesma assinatura comportamental que indicava fraude agora indica comportamento legítimo. Efeito: degradação séria, e nenhuma quantidade de dados novos com features antigas resolve — exige rerotulagem e retreino.

**Label drift / prior shift** — `P(y)` muda. A prevalência mudou. Efeito principal: **descalibração**, mesmo com o poder discriminativo intacto. Corrigível analiticamente ajustando o intercepto/limiar.

**Padrões temporais:**

- **Súbito** — mudança de política, deploy de sistema upstream, pandemia, mudança regulatória.
- **Gradual** — mudança de comportamento ao longo de meses.
- **Sazonal / recorrente** — não é drift verdadeiro, é padrão que o modelo deveria conhecer. Confundir sazonalidade com drift gera retreinos desnecessários e instabilidade.

**Feedback loops** — a categoria mais insidiosa. O modelo **influencia** os dados que ele mesmo vai receber. Um sistema de recomendação só observa cliques em itens que ele mostrou, o que enviesa progressivamente os dados de treino em direção às próprias preferências do modelo. Um modelo de crédito só observa o desempenho de quem foi aprovado, o que impede aprender sobre a região que ele rejeita. Mitigações: **exploração deliberada** (mostrar itens aleatórios a uma fração do tráfego), *holdout* permanente sem intervenção do modelo, e correção por propensão inversa.

### 1.3 Monitoramento

**Camada 1 — Saúde operacional.** Latência (p50, p95, p99 — a média esconde a cauda que os usuários sentem), throughput, taxa de erro, disponibilidade, uso de recursos. É o que qualquer serviço tem, e é o que quebra mais.

**Camada 2 — Qualidade dos dados de entrada.** Frequentemente o mais importante e o mais negligenciado:

- Taxa de valores ausentes por feature (subida súbita = upstream quebrou).
- Valores fora do domínio ou do intervalo esperado.
- Mudança de tipo, de unidade ou de escala.
- Categorias novas nunca vistas.
- **Frescor dos dados** — a feature está sendo atualizada na cadência esperada?
- Volume de requisições por segmento.

**Camada 3 — Drift de distribuição.** Comparar a distribuição atual com a de referência (treino ou uma janela estável):

- **PSI (Population Stability Index)** — o padrão da indústria, especialmente em crédito. Regra prática: < 0.1 estável, 0.1–0.25 mudança moderada, > 0.25 mudança significativa.
- **KS test** — para features contínuas, compara distribuições inteiras.
- **Divergência KL / JS** — sensíveis à cauda; JS é simétrica e limitada, o que a torna mais fácil de interpretar.
- **Chi-square** — para categóricas.
- **Adversarial validation** — treinar um classificador para distinguir dados de treino de dados de produção. Se ele consegue (AUC alto), há drift, e a importância de features diz **exatamente quais** features driftaram. É a técnica mais informativa e a que mais impressiona citar.

**Cuidado que separa candidatos:** com volume alto, **testes estatísticos rejeitam qualquer diferença**, por menor que seja. Monitorar por p-valor gera alarme constante. Use **tamanho do efeito com limiar** (PSI, distância de Wasserstein), não significância.

**Camada 4 — Distribuição das predições.** Monitorar a distribuição dos scores é barato, imediato, e não exige rótulos. Uma mudança na média dos scores ou na taxa de predições positivas é frequentemente o **primeiro sinal** de que algo mudou.

**Camada 5 — Métricas de modelo.** Requer rótulos, e o problema central é o **atraso de rótulo**: em churn de 90 dias, você só sabe se acertou 90 dias depois. Isso significa que a métrica verdadeira é sempre retrospectiva, e o monitoramento em tempo real precisa depender de proxies (camadas 2, 3, 4).

**Camada 6 — Métricas de negócio.** O que decide: receita, conversão, perda por fraude, custo operacional, carga de trabalho humano. **A métrica do modelo pode melhorar e a de negócio piorar** — e é a de negócio que importa.

**Camada 7 — Fairness e segmentação.** Métricas por segmento relevante. A métrica agregada esconde falhas concentradas, e uma degradação séria num grupo minoritário pode ser invisível no agregado (é o paradoxo de Simpson em forma operacional).

### 1.4 Retreino

**Quando retreinar — três estratégias:**

- **Agendado** — diário, semanal, mensal. Simples, previsível, fácil de operar. Pode ser desnecessário ou tardio demais.
- **Por gatilho** — quando o drift ou a queda de métrica cruza um limiar. Mais eficiente, mais complexo, e exige limiares bem calibrados para não oscilar.
- **Contínuo / online learning** — atualização incremental. Necessário quando o ambiente muda muito rápido (recomendação, precificação dinâmica, detecção de fraude adversarial). Risco alto: um lote ruim de dados corrompe o modelo em produção rapidamente, e o rollback é mais difícil.

**A cadência certa depende de:** velocidade do drift, custo do retreino, disponibilidade de rótulos frescos, e custo do erro. Um bom procedimento empírico para determinar: treinar em dados até `T` e avaliar em `T+1 semana`, `T+2`, `T+4`, `T+8` — **a curva de degradação revela a meia-vida do modelo** e a cadência sai daí, em vez de ser chutada. Citar isso é uma resposta muito forte.

**O que retreinar:**

- **Refit** — mesma arquitetura e hiperparâmetros, dados novos. É o caso mais comum e o mais seguro.
- **Retreino completo** — inclui reavaliação de features e hiperparâmetros. Periódico, não a cada ciclo.
- **Redesenho** — quando o problema mudou de natureza.

**Regras que não se quebram:**

- **Retreino automático precisa de validação automática e gate.** Um modelo novo só substitui o antigo se passar em testes: métricas mínimas num conjunto de referência, ausência de regressão em segmentos críticos, e sanidade da distribuição de scores. Sem gate, retreino automático é um mecanismo de propagar corrupção de dados para produção.
- **Sempre comparar o candidato com o modelo atual**, no mesmo conjunto e no mesmo período.
- **Manter capacidade de rollback rápido** e versionamento de modelo, dados, código e features juntos. Um modelo é a combinação dos quatro, e reproduzir sem qualquer um deles é impossível.
- **Janela de dados** é uma decisão real: usar tudo dá mais dados mas inclui regimes obsoletos; janela deslizante adapta mais rápido mas descarta informação. Ponderação temporal é o compromisso.

### 1.5 Serving: batch vs online

**Batch (offline)** — predições computadas periodicamente e gravadas numa tabela ou cache; a aplicação apenas lê.

Vantagens: simples, barato, sem restrição de latência na computação, fácil de monitorar e reprocessar, e a mesma lógica de features do treino pode ser reaproveitada. **Limitação:** as predições são obsoletas por até um ciclo, e não é possível usar informação do momento da requisição.

Adequado quando: as entidades a pontuar são conhecidas de antemão, as features mudam devagar, e a decisão não depende do contexto da sessão. Churn semanal, propensão de campanha, segmentação, scoring de crédito de carteira.

**Online (real-time)** — modelo servido atrás de uma API, predição sob demanda.

Vantagens: usa informação do instante da requisição (contexto da sessão, item sendo visto, dispositivo), sempre atualizado, e viabiliza personalização. **Custos:** orçamento de latência apertado, necessidade de alta disponibilidade, complexidade de servir features em tempo real, e mais superfície de falha.

Adequado quando: a entrada só existe no momento da requisição (fraude na transação, ranking de busca, moderação de conteúdo).

**Streaming / near-real-time** — o meio termo: features atualizadas continuamente por um pipeline de eventos, predições recomputadas em segundos ou minutos. Compromisso comum na prática.

**Padrões híbridos que valem citar:** pré-computar candidatos em batch e reordenar online (é a arquitetura padrão de recomendação); pré-computar embeddings pesados em batch e fazer só a parte leve online; cachear predições online com TTL curto.

### 1.6 Treino-serving skew

**O modo de falha mais comum e mais caro em ML de produção.** A lógica de features no treino difere da do serving, e o modelo recebe entradas diferentes das que aprendeu — sem erro, sem alerta, apenas resultados piores.

**Causas típicas:**

- **Implementações duplicadas** — features escritas em SQL/Spark para treino e reescritas em Python/Java no serviço. Divergem no primeiro ajuste que só é feito de um lado.
- **Diferença temporal** — no treino você agregou "últimos 30 dias" com dados completos; em produção, os últimos eventos ainda não foram processados, então a mesma feature tem valor diferente.
- **Ordem de operações** — imputar antes ou depois de escalonar, tratamento de categorias novas, arredondamento.
- **Rótulos com informação indisponível na inferência** — leakage que só se manifesta em produção.
- **Diferença de versão de biblioteca** entre ambiente de treino e de serving.

**Mitigações:**

- **Fonte única de definição de feature** — a mesma transformação usada nos dois caminhos. É o argumento central para uma feature store.
- **Logar as features usadas na inferência** e comparar com as do treino sobre os mesmos exemplos. É o teste definitivo e ele encontra o problema em minutos.
- **Testes de paridade automatizados** no CI: para um conjunto de exemplos fixos, treino e serving devem produzir vetores idênticos.
- **Empacotar o pré-processamento junto com o modelo** num único artefato, de forma que seja impossível divergir.
- **Shadow deployment** antes de servir tráfego real.

### 1.7 Feature store

**O que resolve** (e o valor da resposta está em explicar os problemas, não em nomear a ferramenta):

1. **Consistência treino-serving** — uma única definição usada nos dois caminhos.
2. **Reuso** — features criadas por um time servem a outros, sem reimplementação.
3. **Point-in-time correctness** — o problema mais difícil e mais importante. Para gerar dados de treino, você precisa do valor que a feature tinha **no instante do evento**, não o valor atual. Fazer isso à mão em SQL é a fonte número um de leakage temporal, e é exatamente o que uma feature store automatiza com *point-in-time joins*.
4. **Serving de baixa latência** — um armazenamento online (chave-valor) para leitura em milissegundos, além do offline para treino.
5. **Governança** — descoberta, documentação, linhagem, versionamento e monitoramento de features.

**Arquitetura típica:** um *offline store* (data warehouse/lake, otimizado para leitura em massa histórica) e um *online store* (Redis, DynamoDB e afins, otimizado para leitura por chave), alimentados pelas mesmas definições de transformação.

**Quando NÃO vale a pena** — e dizer isso é sinal de maturidade: com poucos modelos, um time só, e serving em batch, uma feature store adiciona complexidade operacional significativa sem resolver um problema que você tem. Ela paga quando há **muitos modelos, múltiplos times, e serving online**.

### 1.8 Deploy de modelos

**Estratégias:**

- **Shadow (dark launch)** — o novo modelo recebe tráfego real e faz predições, mas elas **não são usadas**. Compara-se com o modelo atual. Risco zero para o usuário, e valida latência, disponibilidade e diferenças de predição em dados reais. **É o primeiro passo certo em quase todo caso.**
- **Canary** — pequena fração do tráfego (1–5%), aumentando gradualmente com monitoramento. Limita o raio de dano.
- **A/B test** — divisão controlada com medição estatística do impacto de negócio. É o que de fato responde "o modelo novo é melhor?".
- **Blue-green** — dois ambientes completos, troca instantânea e rollback instantâneo.
- **Multi-armed bandit** — aloca tráfego dinamicamente para o que está performando melhor. Mais eficiente que A/B fixo em termos de custo de oportunidade, mas complica a inferência estatística e o diagnóstico.

**Ponto crítico e frequentemente esquecido: métrica offline melhor não garante métrica online melhor.** As razões são as de sempre — a distribuição offline difere da de produção, a métrica offline não é a de negócio, e há efeitos de sistema (latência, feedback loop) que não existem offline. Por isso o A/B test é o critério final, e propor deploy direto com base em AUC offline é uma resposta fraca.

**Cuidado específico de A/B com modelos:** modelos de recomendação e ranking têm **efeitos de longo prazo** (satisfação, retenção, diversidade de catálogo) que testes curtos não capturam, e podem inclusive mostrar melhora de curto prazo com dano de longo prazo. Isso justifica holdouts de longa duração para métricas estruturais.

### 1.9 Reprodutibilidade e governança

**Versionar quatro coisas juntas:** código, dados, configuração/hiperparâmetros, e ambiente. Um modelo é a combinação dos quatro; faltando um, ele não é reproduzível.

**Model registry** — artefatos versionados com metadados: quem treinou, com quais dados, quais métricas, qual estágio (staging/produção/arquivado), e linhagem completa.

**Model card / documentação** — uso pretendido, limitações conhecidas, dados de treino, desempenho por segmento, considerações éticas. Em contextos regulados isso é requisito, não boa prática.

**O que a governança precisa responder** quando algo dá errado: qual versão do modelo produziu esta predição, com quais valores de feature, treinada com quais dados, aprovada por quem. Se você não consegue responder isso, você não tem um sistema auditável.

---

## 2. Perguntas de entrevista

---

**🟢 O que é data drift e como você detecta?**

**Resposta modelo:** Data drift é quando a distribuição das entradas muda em relação à do treino, enquanto a relação entre entrada e alvo permanece a mesma. O modelo passa a operar numa região do espaço de features onde tinha poucos dados, e a performance degrada.

Detecto comparando a distribuição atual com uma de referência, feature a feature: **PSI** é o padrão da indústria, com as faixas de referência de 0.1 e 0.25; **KS test** para contínuas; **chi-square** para categóricas. Monitoro também a distribuição das predições, que é barata e não exige rótulos e frequentemente é o primeiro sinal de que algo mudou.

Um cuidado importante: com volume grande, testes estatísticos rejeitam qualquer diferença por menor que seja, então monitorar por p-valor gera alarme constante. Uso **tamanho de efeito com limiar**, não significância.

**Follow-up:** *"E se você não tem rótulos para medir performance?"* — É o caso comum, por atraso de rótulo. Aí monitoro os proxies: qualidade dos dados de entrada, drift das features, distribuição dos scores, e métricas de negócio que estão disponíveis mais cedo. E rotulo manualmente uma amostra periódica, que é caro mas é a única forma de ter a métrica verdadeira em tempo razoável.

---

**🟡 Qual a diferença entre data drift e concept drift? Por que importa?**

**Resposta modelo:** Data drift é `P(X)` mudar com `P(y|X)` constante — a distribuição de entrada mudou, mas a relação aprendida continua válida. Concept drift é `P(y|X)` mudar — **a relação em si mudou**, e o modelo está errado sobre o mundo, não apenas extrapolando.

A distinção importa porque **as soluções são diferentes**. Para data drift, retreinar com dados novos costuma resolver, porque os rótulos antigos ainda representam a relação certa; e às vezes basta reponderar ou expandir a cobertura de features. Para concept drift, os dados antigos estão **ativamente errados** — retreinar incluindo o histórico pode até piorar, e o que se precisa é de rótulos novos, janela de treino mais curta ou ponderada, e possivelmente features novas que capturem o novo regime.

O exemplo que uso: se minha base de usuários fica mais jovem, isso é data drift — jovens sempre tiveram aquele comportamento de churn, eu só tenho mais deles agora. Se fraudadores adotam uma técnica nova, isso é concept drift — a mesma assinatura comportamental mudou de significado, e nenhum volume de dados históricos ajuda.

Vale mencionar também o **label drift**, quando só a prevalência muda: o efeito principal é descalibração, e frequentemente dá para corrigir analiticamente ajustando o intercepto ou o limiar, sem retreinar.

---

**🟡 O que você monitora num modelo em produção?**

**Resposta modelo:** Em camadas, do que quebra mais para o que importa mais.

**Saúde operacional** — latência em percentis, não média, porque a média esconde a cauda que os usuários sentem; throughput, taxa de erro, disponibilidade.

**Qualidade dos dados de entrada**, que na minha experiência é onde mora a maior parte dos incidentes reais: taxa de nulos por feature, valores fora do intervalo esperado, categorias novas, mudança de tipo ou de unidade, e **frescor** — a feature está sendo atualizada na cadência esperada? Um job upstream que atrasa não gera erro; gera predições ruins silenciosamente.

**Drift de distribuição** das features, com PSI ou KS, e **drift da distribuição das predições**, que é barato e não exige rótulos.

**Métricas de modelo** quando os rótulos chegam, sabendo que elas são sempre retrospectivas por causa do atraso de rótulo.

**Métricas de negócio**, que são o que decide — e vale monitorar porque a métrica do modelo pode melhorar enquanto a de negócio piora.

**E segmentação em todas as camadas.** A métrica agregada esconde degradação concentrada num segmento, que pode ser exatamente o segmento que importa.

Sobre alertas: eu calibraria os limiares para evitar fadiga de alerta, porque um sistema que alerta demais é ignorado, e aí o monitoramento não existe na prática.

---

**🟡 Quando você usa serving batch e quando usa online?**

**Resposta modelo:** A pergunta que decide é: **a informação necessária para a predição existe antes da requisição?**

Se sim, batch. Predições computadas periodicamente e gravadas numa tabela que a aplicação lê. É mais simples, mais barato, sem restrição de latência na computação, mais fácil de monitorar e reprocessar. Serve bem para churn semanal, propensão de campanha, segmentação, scoring de carteira — casos em que as entidades são conhecidas de antemão e as features mudam devagar.

Se a entrada só existe no momento da requisição, online. Fraude numa transação específica, ranking de resultados de busca, moderação de conteúdo, recomendação sensível ao contexto da sessão. O custo é orçamento de latência, alta disponibilidade, e a complexidade de servir features em tempo real.

Na prática o mais comum é um **híbrido**: pré-computar em batch a parte cara — embeddings, agregados históricos, geração de candidatos — e fazer online só a parte leve que depende do contexto. A arquitetura padrão de recomendação é exatamente isso: candidatos gerados em batch, reordenação online.

E eu consideraria o custo total: online exige infraestrutura de alta disponibilidade e mais gente de plantão. Se batch resolve o problema de negócio, batch é a resposta certa mesmo que online seja tecnicamente mais elegante.

---

**🟡 Com que frequência você retreina um modelo?**

**Resposta modelo:** Não chutaria — mediria. O procedimento que eu usaria: treinar com dados até um instante `T` e avaliar em `T+1 semana`, `T+2`, `T+4`, `T+8`. **A curva de degradação revela a meia-vida do modelo**, e a cadência sai daí. Um modelo que perde 1% de AUC em dois meses não precisa de retreino semanal; um que perde 5% em duas semanas precisa de mais que mensal.

A cadência também depende de outros fatores: custo do retreino, disponibilidade de rótulos frescos — não adianta querer retreinar semanalmente se o rótulo demora 30 dias para existir — e custo do erro.

Sobre a estratégia: **agendado** é o mais simples e é o que eu escolheria por padrão, porque é previsível e fácil de operar. **Por gatilho** de drift ou queda de métrica é mais eficiente, mas exige limiares bem calibrados e monitoramento confiável. **Online learning** só quando o ambiente muda muito rápido, porque o risco é alto: um lote ruim de dados corrompe o modelo em produção rapidamente.

E a regra que eu não quebraria: **retreino automático exige validação automática com gate**. O modelo novo só substitui o antigo se passar em métricas mínimas, ausência de regressão em segmentos críticos, e sanidade da distribuição de scores. Sem esse gate, retreino automático é um mecanismo de propagar corrupção de dados direto para produção.

---

**🟡 O modelo funcionava bem e agora está pior. Como você investiga?**

**Resposta modelo:** Da causa mais provável e mais barata de verificar para a menos.

**Primeiro, dados.** A maioria dos incidentes de ML é de dados. Verificaria: algum job upstream mudou ou atrasou? A taxa de nulos subiu em alguma feature? Alguma unidade ou escala mudou — centavos para reais é o exemplo clássico? Apareceram categorias novas? Alguma feature está com valor constante, o que indica pipeline quebrado?

**Segundo, mudanças recentes.** Houve deploy do modelo, de features, ou de qualquer serviço upstream? Correlacionar o início da degradação com o log de mudanças resolve uma fração grande dos casos em minutos.

**Terceiro, drift.** Comparar as distribuições atuais com a referência, por feature e para as predições. Adversarial validation é a técnica que mais ajuda aqui, porque um classificador treinado para distinguir dados de treino de dados atuais indica, pela importância de features, **exatamente quais** features mudaram.

**Quarto, distinguir data drift de concept drift**, porque as ações são diferentes. Se a performance caiu mas a distribuição das features não mudou, é concept drift — a relação mudou, e retreinar com histórico pode não resolver.

**Quinto, é degradação real ou artefato de medição?** Os rótulos estão chegando de forma completa e no mesmo prazo? Mudou a composição da população avaliada? Segmentar antes de concluir, porque uma queda agregada pode ser mudança de mix e não degradação em nenhum segmento — é o paradoxo de Simpson na prática.

**Sexto, feedback loop.** O modelo está influenciando os dados que recebe, criando uma espiral. Isso é sutil e requer olhar dados de exploração ou de holdout.

Enquanto investigo, eu consideraria mitigação imediata: rollback para a versão anterior, ou ajuste de limiar para trazer o volume de decisões de volta ao esperado, enquanto a causa raiz é resolvida.

---

**🔴 O que é treino-serving skew e como você previne?**

**Resposta modelo:** É quando a lógica de features usada no treino difere da usada no serving, então o modelo recebe entradas diferentes das que aprendeu. É o modo de falha mais comum e mais caro em ML de produção, e o pior é que **é silencioso**: não gera erro, só piora os resultados.

As causas típicas são: **implementações duplicadas** — a feature escrita em SQL para o treino e reescrita em Python no serviço, divergindo no primeiro ajuste feito de um lado só; **diferença temporal** — no treino você agregou "últimos 30 dias" com dados completos, mas em produção os eventos mais recentes ainda não foram processados, então a mesma feature tem valores diferentes; **ordem de operações** no pré-processamento; e **diferença de versão de biblioteca** entre os ambientes.

A prevenção: **fonte única de definição de feature**, usada nos dois caminhos — é o argumento central para uma feature store; **empacotar o pré-processamento junto com o modelo** num único artefato, para que seja impossível divergir; **testes de paridade automatizados** no CI, verificando que para exemplos fixos os dois caminhos produzem vetores idênticos; e **shadow deployment** antes de servir tráfego real.

E a detecção definitiva, que eu faria sempre: **logar os vetores de feature usados na inferência** e compará-los com os gerados pelo pipeline de treino para os mesmos exemplos. Se divergem, você achou o problema em minutos em vez de semanas.

---

**🔴 Como você faria deploy de um novo modelo com segurança?**

**Resposta modelo:** Em etapas, cada uma respondendo uma pergunta diferente, e sem pular para o A/B direto.

**Validação offline** — o candidato bate o modelo atual no mesmo conjunto e no mesmo período? Incluindo por segmento, porque uma melhoria agregada pode esconder regressão num segmento importante.

**Shadow deployment** — o novo modelo recebe tráfego real de produção e faz predições que não são usadas. Isso responde perguntas que offline não responde: a latência é aceitável em condições reais? As features chegam corretamente? A distribuição de predições é o que eu esperava? Quanto os dois modelos discordam, e nos casos em que discordam, quem parece estar certo? **Risco zero para o usuário**, e é onde a maior parte dos problemas de engenharia aparece.

**Canary** — 1 a 5% do tráfego, com monitoramento fechado e critérios de rollback definidos **antes**. Aumento gradual se as métricas se mantiverem.

**A/B test** — divisão controlada para medir o impacto real nas métricas de negócio, com tamanho de amostra e duração calculados de antemão, e com guardrails definidos.

**Ramp completo**, mantendo capacidade de rollback rápido e, se as métricas forem estruturais — retenção, diversidade de catálogo — um holdout de longa duração, porque modelos de ranking podem melhorar métricas de curto prazo e degradar as de longo.

O ponto que eu enfatizaria: **métrica offline melhor não garante métrica online melhor**, porque a distribuição offline difere da de produção, a métrica offline não é a de negócio, e existem efeitos de sistema que não existem offline. O A/B é o critério final, e propor deploy com base só em AUC offline é uma resposta incompleta.

---

**🔴 O que é uma feature store e quando ela vale a pena?**

**Resposta modelo:** É uma camada que centraliza definição, computação, armazenamento e serving de features. Ela resolve cinco problemas concretos, e o valor está neles, não na ferramenta.

**Consistência treino-serving** — uma única definição usada nos dois caminhos, eliminando a causa principal de skew. **Reuso** — features criadas por um time servem a outros sem reimplementação. **Point-in-time correctness**, que é o problema mais difícil: para gerar dados de treino você precisa do valor que a feature tinha **no instante do evento**, não o valor atual, e fazer isso à mão em SQL é a fonte número um de leakage temporal. Uma feature store automatiza isso com point-in-time joins. **Serving de baixa latência** através de um armazenamento online chave-valor, além do offline para treino. E **governança** — descoberta, documentação, linhagem, versionamento.

Sobre quando vale: ela paga quando há **muitos modelos, múltiplos times, e serving online**, porque aí os problemas de duplicação, inconsistência e reuso são reais e caros. Com poucos modelos, um time e serving em batch, ela adiciona complexidade operacional significativa sem resolver um problema que você tem — e nesse caso eu preferiria disciplina em pipelines versionados e testes de paridade, que capturam a maior parte do benefício por uma fração do custo.

---

**🔴 Como você lida com feedback loops em ML de produção?**

**Resposta modelo:** O problema é que o modelo influencia os dados que ele mesmo vai receber, então o treino futuro é contaminado pelas decisões do modelo atual. Um recomendador só observa cliques em itens que ele mostrou, o que reforça progressivamente suas próprias preferências e estreita o catálogo. Um modelo de crédito só observa o desempenho de quem foi aprovado, então nunca aprende sobre a região que ele rejeita, e o viés se cristaliza.

As mitigações, e todas custam alguma coisa no curto prazo:

**Exploração deliberada** — uma fração do tráfego recebe itens aleatórios ou escolhidos com incerteza alta, gerando dados não enviesados. É o custo de aprendizado, e é a mitigação mais direta. Bandits formalizam esse trade-off.

**Holdout permanente** — uma fração pequena de usuários que nunca recebe intervenção do modelo, servindo como linha de base não contaminada. Permite medir o efeito real do sistema ao longo do tempo, não só a diferença entre versões.

**Correção por propensão** — registrar a probabilidade com que cada item foi mostrado e reponderar as observações no treino pelo inverso dela, o que corrige parte do viés de seleção. Exige logar a propensão no momento da decisão, o que precisa ser desenhado desde o início.

**Monitorar sinais de colapso** — concentração de exposição em poucos itens, queda de cobertura de catálogo, redução de diversidade. Esses sinais aparecem antes da métrica de negócio degradar.

**Para o caso de crédito especificamente**, existe a técnica de aprovar deliberadamente uma pequena fração de solicitantes que seriam rejeitados, para obter rótulos naquela região do espaço. É caro e precisa de aprovação de negócio, mas é a única forma de saber se a fronteira de decisão está no lugar certo.

E eu diria explicitamente que este é um problema onde **a métrica de curto prazo engana**: um sistema que explora menos parece melhor hoje e fica pior em alguns meses. Por isso a decisão precisa ser tomada com métricas de longo prazo e defendida como investimento.

---

## 3. Armadilhas comuns

**Achar que o trabalho acaba no deploy.** Modelos degradam sozinhos; sem monitoramento, você está falhando silenciosamente agora.

**Monitorar só métricas de modelo.** A maioria dos incidentes é de dados e aparece primeiro na camada de qualidade de entrada.

**Usar p-valor para detectar drift.** Com volume alto, tudo é significativo. Use tamanho de efeito com limiar.

**Confundir data drift com concept drift.** As ações corretivas são diferentes, e retreinar com histórico pode piorar no segundo caso.

**Confundir sazonalidade com drift.** Gera retreinos desnecessários e instabilidade.

**Retreino automático sem gate de validação.** É um mecanismo de levar corrupção de dados direto para produção.

**Não versionar dados e ambiente junto com o código.** O modelo não é reproduzível.

**Escrever a lógica de features duas vezes.** Skew garantido no primeiro ajuste feito de um lado só.

**Fazer deploy baseado só em métrica offline.** A correlação com o resultado online é frequentemente fraca.

**Pular o shadow deployment.** É onde a maior parte dos problemas de engenharia aparece com risco zero.

**Monitorar apenas métricas agregadas.** Degradação concentrada em segmentos fica invisível.

**Usar média de latência em vez de percentis.** A média esconde a cauda que os usuários de fato sentem.

**Ignorar feedback loops.** O viés se acumula e a métrica de curto prazo esconde o problema.

**Adotar uma feature store sem ter os problemas que ela resolve.** Complexidade sem retorno.

**Não ter plano de rollback.** Perguntar "e se der errado?" antes de subir é parte do trabalho.

**Ignorar o atraso de rótulo ao planejar monitoramento e retreino.** Você não pode retreinar semanalmente com rótulos que levam 30 dias.
