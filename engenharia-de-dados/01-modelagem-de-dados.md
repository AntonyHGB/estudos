# 01 — Modelagem de Dados

> OLTP vs OLAP · Normalização · Star vs Snowflake · Slowly Changing Dimensions · Data Vault · One Big Table

Este é o tópico mais cobrado em entrevistas de engenharia de dados e o que mais gente responde de forma decorada. A diferença entre um candidato mediano e um bom candidato aqui quase nunca é conhecer os nomes — é saber **por que** cada decisão de modelagem existe.

---

## 1. Resumo conceitual

### 1.1 A pergunta que está por trás de toda modelagem

Modelagem de dados é a resposta a uma única tensão: **o formato que é ótimo para escrever não é o formato que é ótimo para ler.**

Um sistema que registra pedidos precisa gravar um pedido por vez, rápido, sem duplicar informação e sem risco de inconsistência. Um sistema que responde "qual foi a receita por região por mês nos últimos 3 anos" precisa varrer bilhões de linhas e agregar. Esses dois objetivos são fisicamente opostos: o primeiro quer o dado espalhado em muitas tabelas pequenas e estreitas (escrita barata, atualização em um lugar só); o segundo quer o dado junto e pré-combinado (leitura barata, sem precisar reconstruir contexto a cada consulta).

Toda técnica deste arquivo é uma forma de gerenciar essa tensão. Se você entender isso, consegue derivar as respostas em vez de decorá-las.

### 1.2 OLTP vs OLAP

**OLTP (Online Transaction Processing)** é o mundo do sistema operacional: o app, o checkout, o cadastro. Características:

- Muitas transações pequenas e concorrentes, com leitura e escrita misturadas.
- Acesso quase sempre por chave: "me dê o pedido 12345", "atualize o saldo do cliente 987".
- Latência medida em milissegundos, para uma requisição de usuário.
- Precisa de garantias ACID fortes, porque um erro é dinheiro ou dado corrompido de um cliente real.
- Modelado **normalizado** (tipicamente 3FN), para que cada fato exista em um lugar só e uma atualização não precise ser replicada.
- Armazenamento **orientado a linha**: como você lê o registro inteiro de uma entidade, faz sentido guardar os campos daquele registro fisicamente juntos.
- Índices B-tree em chaves e colunas de busca; muitos índices, porque as consultas são seletivas.

**OLAP (Online Analytical Processing)** é o mundo analítico: dashboards, relatórios, modelos, ciência de dados. Características:

- Poucas consultas, mas cada uma varre muito dado.
- Acesso por *fatia*, não por chave: "some `valor` de todas as vendas do último trimestre, agrupadas por categoria".
- Latência aceitável de segundos a minutos.
- Carga em lote ou micro-lote; escrita append-only; updates raros e caros.
- Modelado **desnormalizado** (star schema, wide tables), para eliminar joins do caminho crítico da consulta.
- Armazenamento **colunar**: como uma consulta típica lê 4 colunas de uma tabela de 200, guardar cada coluna separada evita ler as outras 196.
- Poucos ou nenhum índice tradicional; em vez disso, particionamento, clustering, min/max statistics por bloco e zone maps.

**O ponto que diferencia uma boa resposta:** OLTP e OLAP não diferem só em "como as pessoas usam". Diferem em **padrão de acesso**, e todas as outras escolhas (layout físico, normalização, índices, garantias transacionais) são consequência do padrão de acesso. Se o entrevistador perguntar "por que colunar é rápido em OLAP", a resposta certa é sobre I/O: você lê só as colunas necessárias, e como valores de uma mesma coluna são do mesmo tipo e frequentemente similares, comprimem muito melhor (run-length, dictionary encoding). Menos bytes lidos = mais rápido. Não é magia, é volume de I/O.

Existe ainda **HTAP** (Hybrid Transactional/Analytical Processing) — sistemas que tentam servir os dois padrões na mesma engine (SingleStore, TiDB, alguns modos do Databricks e do Snowflake). Vale mencionar como nuance: o mercado tem convergido, mas a separação clássica ainda domina porque isolar cargas analíticas do banco de produção é uma decisão de risco operacional, não só de performance.

### 1.3 Normalização

Normalização é o processo de decompor tabelas para eliminar redundância e anomalias de atualização.

- **1FN**: valores atômicos, sem grupos repetidos. Nada de um campo `telefones` com "1199,1198" dentro.
- **2FN**: 1FN + todo atributo não-chave depende da chave primária **inteira** (só faz diferença com chave composta).
- **3FN**: 2FN + nenhum atributo não-chave depende de outro atributo não-chave (sem dependência transitiva). Se você tem `cep`, `cidade` e `estado` na tabela de pedidos, `cidade` depende de `cep`, não do pedido — violação de 3FN.
- **BCNF**: refinamento da 3FN para casos com múltiplas chaves candidatas sobrepostas. Raramente cobrado, bom mencionar de passagem.

**O benefício real da normalização não é economia de espaço.** Espaço é barato. O benefício é **integridade**: se o nome de um produto existe num lugar só, é impossível ele estar diferente em dois lugares. Anomalia de atualização é o problema que a normalização resolve.

**O custo é join.** Cada nível de normalização adicional é um join a mais para reconstruir a informação. Em OLTP, isso é aceitável: você faz joins seletivos, com índices, retornando poucas linhas. Em OLAP, um join entre duas tabelas de bilhões de linhas custa um shuffle distribuído, e é aí que a desnormalização passa a valer a pena.

**Desnormalização** é a escolha deliberada de duplicar dados para evitar joins na leitura. Você troca integridade automática por velocidade de leitura — e assume a responsabilidade de manter as cópias consistentes no processo de ETL/ELT. Isso é aceitável em analytics porque a escrita é controlada por pipeline, não por milhares de usuários concorrentes.

### 1.4 Modelagem dimensional: fatos e dimensões

A modelagem dimensional (Kimball) organiza os dados analíticos em dois tipos de tabela:

**Tabela fato** guarda as *medições* de um processo de negócio. Uma linha = um evento no grão definido (uma venda, um item de venda, um clique, um saldo diário). Contém:
- **Chaves estrangeiras** para as dimensões (`sk_cliente`, `sk_produto`, `sk_data`).
- **Métricas / medidas** numéricas (`quantidade`, `valor_bruto`, `desconto`).
- Opcionalmente, **degenerate dimensions**: atributos como `numero_do_pedido` que são identificadores sem tabela dimensão própria.

Tabelas fato são altas e estreitas: bilhões de linhas, poucas colunas, quase tudo numérico.

**Tabela dimensão** guarda o *contexto* descritivo: quem, o quê, onde, quando. Uma linha = uma entidade (um cliente, um produto). Contém atributos textuais usados para filtrar e agrupar (`categoria`, `regiao`, `segmento_cliente`). São largas e baixas: muitas colunas, relativamente poucas linhas.

**Grão (grain)** é o conceito mais importante e o mais negligenciado. O grão é a definição precisa do que representa **uma linha** da tabela fato. "Uma linha por item de pedido" é diferente de "uma linha por pedido", e escolher errado quebra tudo depois. Declarar o grão é a primeira coisa que se faz ao modelar — antes de escolher dimensões, antes de escolher métricas. Numa entrevista, se o entrevistador pede para modelar algo e você começa dizendo "primeiro eu defino o grão da fato como...", você já se diferenciou.

**Tipos de tabela fato:**
- **Transacional**: uma linha por evento que aconteceu. O mais comum. Aditiva, granular, append-only.
- **Snapshot periódico**: uma linha por entidade por período (saldo de cada conta no fim de cada dia). Cresce previsivelmente, permite responder "quanto tinha em X" sem reconstruir histórico.
- **Snapshot acumulado (accumulating)**: uma linha por processo com múltiplas etapas, atualizada conforme avança (um pedido com colunas `data_pedido`, `data_pagamento`, `data_envio`, `data_entrega`). Útil para medir lead time entre etapas. Diferente das outras, ela **sofre update**.
- **Factless fact**: fato sem métrica numérica, que registra a ocorrência de um relacionamento (aluno matriculado numa turma num semestre; promoção vigente para um produto num dia). Serve para contar eventos ou para responder "o que *não* aconteceu" (produtos em promoção que não venderam).

**Tipos de métrica — cai como pegadinha:**
- **Aditiva**: pode somar em todas as dimensões (`valor_venda`).
- **Semi-aditiva**: pode somar em algumas dimensões, mas não em tempo (`saldo_conta` — somar saldos de contas diferentes no mesmo dia faz sentido; somar o saldo da mesma conta em dias diferentes não).
- **Não-aditiva**: não pode somar em nenhuma dimensão (percentuais, taxas, ratios). A regra prática é armazenar numerador e denominador separadamente como métricas aditivas e calcular o ratio na consulta — nunca armazenar a média pré-calculada, porque média de médias está errada quando os grupos têm tamanhos diferentes.

### 1.5 Star schema vs Snowflake schema

**Star schema**: uma tabela fato central ligada diretamente a dimensões **desnormalizadas**. A dimensão produto contém `produto`, `subcategoria`, `categoria`, `departamento` todos na mesma tabela, com redundância assumida.

**Snowflake schema**: as dimensões são **normalizadas** em sub-dimensões. `dim_produto` aponta para `dim_subcategoria`, que aponta para `dim_categoria`, e assim por diante. O diagrama parece um floco de neve.

| | Star | Snowflake |
|---|---|---|
| Joins por consulta | 1 nível (fato → dim) | Vários níveis (fato → dim → subdim) |
| Legibilidade para analista/BI | Alta | Baixa |
| Redundância nas dimensões | Alta | Baixa |
| Integridade automática | Menor (depende do ETL) | Maior |
| Espaço em disco | Maior (irrelevante na prática) | Menor |
| Performance de consulta | Geralmente melhor | Geralmente pior |

**A resposta madura é: prefira star por padrão.** As razões:

1. Dimensões são pequenas comparadas à fato. Economizar espaço numa tabela de 50 mil produtos é irrelevante quando a fato tem 5 bilhões de linhas.
2. Ferramentas de BI e otimizadores de query lidam melhor com star. Muitos engines têm otimizações específicas de star schema (star join optimization, bloom filters de dimensão para pruning da fato).
3. Analistas escrevem SQL contra esse modelo. Reduzir carga cognitiva humana tem valor econômico real.

**Quando snowflake se justifica:** dimensões genuinamente enormes onde a redundância pesa (raro); hierarquias que mudam com frequência e precisam ser mantidas num lugar só; ou quando a sub-dimensão é reutilizada por muitas dimensões diferentes e precisa ser conformada. Também aparece naturalmente quando a plataforma tem restrições de custo de storage — cada vez menos comum.

**Dimensão conformada (conformed dimension)** é o conceito que sustenta a escalabilidade do modelo: uma dimensão compartilhada por vários data marts, com o mesmo significado e as mesmas chaves. `dim_cliente` usada tanto pela fato de vendas quanto pela de suporte permite comparar receita e chamados pelo mesmo cliente. Sem dimensões conformadas, você tem silos que não se conversam — e o **data warehouse bus matrix** de Kimball (processos de negócio nas linhas, dimensões nas colunas) é a ferramenta de planejamento que garante isso.

### 1.6 Chaves: natural, surrogate e hash

**Chave natural (business key)**: o identificador que o negócio usa — CPF, SKU, `id` do sistema de origem.

**Chave substituta (surrogate key)**: um identificador sem significado de negócio, gerado pelo warehouse — normalmente um inteiro sequencial.

Por que usar surrogate key (esta pergunta cai muito):

1. **Permite SCD Tipo 2.** Se o cliente muda de endereço e você quer manter as duas versões, precisa de duas linhas com a mesma chave natural. A chave primária tem que ser outra coisa.
2. **Isola o warehouse de mudanças na origem.** Se o sistema de origem trocar de formato de ID, ou se você integrar duas origens com IDs conflitantes, o warehouse não quebra.
3. **Performance.** Inteiro de 4/8 bytes é mais barato de comparar e armazenar em bilhões de linhas de fato do que uma string de 40 caracteres.
4. **Lida com registros sem chave natural** ou com origens diferentes que representam a mesma entidade.
5. **Permite linhas especiais** para casos de exceção: `-1 = desconhecido`, `-2 = não aplicável`, `-3 = ainda não chegou`. Isso é o que permite usar INNER JOIN em vez de LEFT JOIN entre fato e dimensão, evitando NULLs em chave estrangeira.

Uma variação moderna é a **hash key** (hash da chave natural, como em Data Vault): permite gerar a chave de forma determinística e paralela, sem coordenação central para gerar sequências — o que importa em ambientes distribuídos onde sequências são um gargalo. O custo é colisão (desprezível com SHA-256) e perda de ordenação natural.

### 1.7 Slowly Changing Dimensions (SCD)

O problema: atributos de dimensão mudam ao longo do tempo (cliente muda de cidade, produto muda de categoria). O que fazer com o histórico?

**Tipo 0 — Retain original.** O atributo nunca muda depois de gravado. Usado para dados imutáveis por definição (data de nascimento, data de abertura da conta).

**Tipo 1 — Overwrite.** Sobrescreve o valor antigo. Sem histórico. Simples e barato.
- *Quando usar:* correção de erro (o CEP estava digitado errado), ou quando o negócio explicitamente não se importa com o histórico daquele atributo.
- *Custo:* relatórios históricos mudam retroativamente. Se você sobrescrever a região do vendedor, o relatório de vendas de 2023 vai passar a atribuir as vendas antigas à região nova. Isso pode ser exatamente o desejado ou um desastre — depende do negócio, e essa é a pergunta que você deve fazer.

**Tipo 2 — Add new row.** A mudança gera uma **nova linha** na dimensão, com nova surrogate key. Colunas de controle: `data_inicio_validade`, `data_fim_validade`, `flag_registro_atual`, e frequentemente `versao`. A chave natural se repete entre as versões; a surrogate key é única.
- É o **padrão de fato** para preservar histórico e o que quase toda entrevista quer ouvir.
- Fatos antigas continuam apontando para a surrogate key da versão vigente **no momento do evento**, então relatórios históricos permanecem corretos. Isso se chama preservar o contexto histórico, e é o ponto central.
- *Custo:* a dimensão cresce; a lógica de carga fica mais complexa (detectar mudança, fechar a linha anterior, abrir a nova); consultas de "estado atual" precisam filtrar por `flag_registro_atual = true`.
- Detalhe fino que impressiona: as datas de validade devem ser um intervalo semiaberto `[inicio, fim)` para evitar ambiguidade na borda, e a linha corrente costuma usar `9999-12-31` como fim em vez de NULL, porque NULL complica os predicados de BETWEEN.

**Tipo 3 — Add new column.** Mantém uma coluna adicional com o valor anterior (`regiao_atual`, `regiao_anterior`).
- Preserva **apenas uma** mudança (ou um número fixo delas). Não é histórico completo.
- *Quando usar:* reorganizações pontuais onde o negócio quer analisar os dados "pela estrutura antiga" e "pela nova" simultaneamente por um período. É o caso clássico: mudança de território de vendas.

**Tipo 4 — Mini-dimension / history table.** Separa os atributos que mudam rápido numa tabela própria. Duas variantes usadas na prática:
- Uma tabela "corrente" enxuta + uma tabela de histórico separada.
- Uma **mini-dimensão** com combinações de atributos voláteis (faixa de renda, faixa etária, score), referenciada diretamente pela fato, evitando explodir a dimensão principal em milhões de versões.

**Tipo 6 — Híbrido (1+2+3).** Linhas versionadas como Tipo 2, mas com colunas adicionais que sempre carregam o valor **atual** do atributo. Isso permite responder as duas perguntas com a mesma tabela: "quanto vendeu a região à qual o vendedor pertencia na época" (coluna versionada) e "quanto vendeu a região à qual ele pertence hoje" (coluna atual). O nome vem de 1+2+3 = 6.

**Tipo 7 — Dual keys.** A fato carrega tanto a surrogate key (visão histórica) quanto a chave natural durável (visão atual), permitindo escolher a perspectiva no momento da consulta via views distintas.

**Como um entrevistador testa isso de verdade:** ele não pergunta "o que é SCD Tipo 2". Ele descreve um cenário — "o gerente da loja mudou em junho; como você garante que as vendas de janeiro apareçam sob o gerente antigo?" — e espera que você chegue ao Tipo 2 sozinho, e que pergunte se o negócio quer a visão histórica ou a atual.

### 1.8 Data Vault

Data Vault 2.0 é uma metodologia de modelagem para a camada de integração do warehouse (não para consumo final). Divide tudo em três estruturas:

- **Hub**: a lista de chaves de negócio de uma entidade. Contém a business key, sua hash key, data de carga e sistema de origem. Nada mais. Um hub de cliente tem os CPFs existentes, ponto.
- **Link**: relacionamentos entre hubs. Um link de "cliente comprou produto" contém as hash keys dos hubs envolvidos. Todos os relacionamentos são modelados como many-to-many, independentemente da cardinalidade real hoje.
- **Satellite**: os atributos descritivos e seu histórico. Ligado a um hub ou link, com `load_date` e hash diff para detectar mudanças. Todo histórico vive aqui, sempre em modo insert-only.

**Por que existe:** a promessa é **auditabilidade total e resiliência a mudança**. Como tudo é insert-only e a estrutura é altamente decomposta, você consegue: (a) reconstruir o estado do dado em qualquer instante passado, incluindo o que a origem disse mesmo quando ela estava errada; (b) adicionar uma nova fonte ou um novo relacionamento sem refatorar o modelo existente — você acrescenta hubs, links e satélites, não altera os antigos; (c) carregar tudo em paralelo, porque as hash keys removem a dependência de lookup sequencial.

**Custos, e são grandes:**
- Explosão de tabelas. Um modelo que teria 20 tabelas dimensionais pode ter 150 em Data Vault.
- Consultar diretamente é impraticável — exige muitos joins. Por isso Data Vault **sempre** vem acompanhado de uma camada de apresentação (tipicamente star schema) construída em cima. Data Vault não substitui modelagem dimensional; ele fica atrás dela.
- Curva de aprendizado alta e sensível a disciplina de equipe.

**Quando usar:** múltiplas fontes heterogêneas que mudam com frequência, exigência regulatória forte de auditoria (bancos, seguros, saúde), organizações grandes com muitas equipes contribuindo para o mesmo warehouse. **Quando não usar:** empresa pequena, poucas fontes, prazo curto. Aí é overhead puro e o star schema direto resolve.

### 1.9 Alternativas modernas: One Big Table e Wide Tables

Com engines colunares modernas, surgiu um contraponto ao star schema: a **OBT (One Big Table)**, uma tabela totalmente desnormalizada, com dimensões já achatadas dentro da fato.

- *A favor:* zero joins na consulta; compressão colunar torna a redundância barata; o usuário final não precisa saber modelar; performance excelente para o caso de uso específico.
- *Contra:* reprocessamento caro quando um atributo de dimensão muda (você precisa reescrever a tabela inteira, não uma linha da dimensão); explosão de tabelas quando cada time cria a sua; perda das dimensões conformadas e, com elas, da capacidade de cruzar domínios; e dificuldade de manter definições consistentes.

Na prática, o padrão comum hoje é **star schema na camada modelada + OBT/wide tables como camada de consumo materializada para casos específicos**. Se numa entrevista você disser "star schema está obsoleto porque temos colunar", vai levar contra-argumento. A resposta correta é que colunar mudou o *peso* do trade-off, não o trade-off em si.

Vale conhecer também **Medallion Architecture** (Bronze/Silver/Gold), que é uma convenção de camadas, não de modelagem: Bronze = dado bruto ingerido como veio; Silver = limpo, deduplicado, conformado; Gold = agregado e modelado para consumo. Aparece muito em contextos Databricks. É ortogonal ao debate Kimball/Inmon/Vault — você pode usar star schema na camada Gold.

**Inmon vs Kimball** (a briga clássica, ainda cobrada): Inmon propõe um warehouse corporativo normalizado em 3FN como fonte única, e data marts dimensionais derivados dele (top-down). Kimball propõe construir data marts dimensionais diretamente, integrados por dimensões conformadas (bottom-up). Na prática, arquiteturas modernas são híbridas: uma camada de integração normalizada ou em Data Vault, e uma camada de consumo dimensional. A resposta que soa madura é reconhecer que a distinção importa menos hoje do que importava, porque o custo de storage e compute mudou as premissas econômicas dos dois modelos.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Qual a diferença entre OLTP e OLAP?**

*Resposta modelo:* OLTP serve o sistema operacional: transações pequenas e frequentes, acesso por chave, latência de milissegundos, ACID forte, modelo normalizado e armazenamento em linha. OLAP serve análise: poucas consultas que varrem muito dado, acesso por fatia e agregação, latência de segundos, carga em lote, modelo desnormalizado e armazenamento colunar. A diferença raiz é o padrão de acesso — todas as outras escolhas derivam dele. Separá-los também isola a carga analítica do banco de produção, o que é uma decisão de risco operacional além de performance.

*Follow-up esperado:* "Por que colunar é melhor para OLAP?" → Porque a consulta lê poucas colunas de muitas; formato colunar permite ler só as necessárias, e valores de mesmo tipo e domínio na mesma coluna comprimem muito melhor (dictionary, run-length). Menos I/O e melhor uso de vetorização na CPU.

---

**🟢 P2. O que é normalização e até que forma normal se costuma ir?**

*Resposta modelo:* É decompor tabelas para eliminar redundância e anomalias de atualização. 1FN exige valores atômicos; 2FN elimina dependência parcial da chave composta; 3FN elimina dependência transitiva entre atributos não-chave. Na prática, 3FN é o alvo em OLTP — BCNF e superiores raramente compensam. O ganho principal não é espaço, é integridade: cada fato existe em um lugar só, então é impossível ficar inconsistente. O custo é join na leitura, e é por isso que warehouses desnormalizam.

*Pegadinha comum:* candidatos dizem que normalização serve para "economizar espaço". Espaço é o benefício menos importante e o mais desatualizado. Diga integridade.

---

**🟢 P3. O que é star schema? Explique fato e dimensão.**

*Resposta modelo:* É um modelo dimensional com uma tabela fato central ligada a dimensões desnormalizadas. A fato guarda as medições de um processo de negócio, uma linha por evento no grão definido, contendo chaves estrangeiras para dimensões e métricas numéricas. As dimensões guardam o contexto descritivo usado para filtrar e agrupar. Fatos são altas e estreitas; dimensões são largas e baixas. O nome vem do formato do diagrama.

*Follow-up quase garantido:* "O que é o grão?" → É a definição precisa do que representa uma linha da fato. É a primeira decisão da modelagem, antes de escolher dimensões ou métricas, porque tudo depende dela. Exemplo: "uma linha por item de pedido" versus "uma linha por pedido" produz modelos incompatíveis.

---

### 🟡 Intermediário

**🟡 P4. Star ou snowflake? Justifique.**

*Resposta modelo:* Por padrão, star. As dimensões são pequenas em relação à fato, então a economia de espaço do snowflake é irrelevante enquanto o custo de joins adicionais em cada consulta é real. Além disso, ferramentas de BI e otimizadores têm otimizações específicas para star join, e analistas escrevem SQL contra esse modelo — reduzir complexidade humana tem valor. Eu consideraria snowflake se a hierarquia mudasse com muita frequência e precisasse ser mantida num único lugar, ou se uma sub-dimensão fosse reutilizada por muitas dimensões diferentes e precisasse ser conformada.

*Follow-up:* "E se a dimensão tiver 500 milhões de linhas?" → Aí o cálculo muda. Uma dimensão gigante (dimensão de usuário numa plataforma de consumo, por exemplo) pode justificar snowflake parcial, ou uma mini-dimensão separando os atributos de alta cardinalidade e alta volatilidade, ou uma abordagem de bridge table. Vale também questionar se aquilo é mesmo dimensão ou se virou uma fato disfarçada.

---

**🟡 P5. Explique SCD Tipo 1, 2 e 3, e diga quando usar cada um.**

*Resposta modelo:* Tipo 1 sobrescreve — sem histórico, usado para correção de erro ou quando o negócio não quer histórico daquele atributo; o efeito colateral é que relatórios históricos mudam retroativamente. Tipo 2 cria uma nova linha com nova surrogate key e colunas de validade (`data_inicio`, `data_fim`, `flag_atual`) — preserva histórico completo e é o padrão para atributos onde o contexto histórico importa. Tipo 3 adiciona uma coluna com o valor anterior — preserva só uma mudança, útil em reorganizações pontuais onde o negócio quer ver os dados pelas duas estruturas ao mesmo tempo. Na prática, aplico o tipo por atributo, não por tabela: a mesma dimensão pode ter atributos Tipo 1 e Tipo 2.

*Esse último ponto é o que separa a resposta boa da decorada.* Muita gente responde como se o tipo fosse uma propriedade da dimensão inteira.

*Follow-ups comuns:*
- "Como você detecta que houve mudança?" → Comparação campo a campo ou, mais eficiente, hash dos atributos relevantes (hash diff) comparado com o hash da versão corrente.
- "O que acontece com as tabelas fato já carregadas?" → Nada. Elas continuam apontando para a surrogate key da versão que estava vigente no momento do evento. É exatamente isso que preserva a correção histórica.
- "E se um registro chegar atrasado, com data anterior à versão corrente?" → Isso é late-arriving data e exige tratamento explícito: inserir a versão retroativamente e ajustar os intervalos de validade das linhas vizinhas. É um caso que quebra implementações ingênuas.

---

**🟡 P6. Por que usar surrogate keys em vez da chave natural?**

*Resposta modelo:* Cinco motivos. Primeiro, e o mais importante: SCD Tipo 2 exige múltiplas linhas com a mesma chave natural, então a chave primária tem que ser outra coisa. Segundo, isolamento: se o sistema de origem mudar o formato do ID ou se eu integrar duas origens com IDs conflitantes, o warehouse não quebra. Terceiro, performance: um inteiro é mais barato de comparar e armazenar em bilhões de linhas de fato do que uma string longa. Quarto, permite linhas especiais na dimensão para "desconhecido" ou "não aplicável", o que evita NULL em chave estrangeira e permite usar INNER JOIN. Quinto, lida com entidades sem chave natural estável.

*Follow-up:* "E hash keys?" → São a alternativa moderna usada em Data Vault e em ambientes distribuídos: geradas determinísticamente a partir da chave natural, permitindo carga paralela sem coordenação central para gerar sequências. O trade-off é perder ordenação e aceitar risco (desprezível) de colisão.

---

**🟡 P7. O que é uma factless fact table e para que serve?**

*Resposta modelo:* É uma tabela fato sem métrica numérica, que registra apenas a ocorrência de um relacionamento entre dimensões. Dois usos: registrar eventos que não têm medida (aluno matriculado numa turma num semestre — a métrica é a contagem de linhas), e registrar cobertura ou elegibilidade (quais produtos estavam em promoção em cada dia). O segundo uso é o mais interessante, porque permite responder perguntas sobre o que **não** aconteceu: fazendo a diferença entre a factless de promoções vigentes e a fato de vendas, você descobre quais produtos em promoção não venderam — algo que a fato de vendas sozinha nunca poderia responder, porque ausência de venda não gera linha.

---

**🟡 P8. Como você modelaria uma métrica que é um percentual, como taxa de conversão?**

*Resposta modelo:* Não armazenaria o percentual. Percentual é não-aditivo: a média de médias está errada quando os grupos têm tamanhos diferentes. Armazenaria numerador e denominador como duas métricas aditivas (`conversoes` e `sessoes`) e calcularia a razão no momento da consulta, depois da agregação. Assim a métrica está correta em qualquer nível de agregação. O mesmo raciocínio vale para ticket médio, margem percentual e qualquer ratio.

---

### 🔴 Avançado

**🔴 P9. O que é Data Vault e quando você o usaria em vez de modelagem dimensional?**

*Resposta modelo:* Data Vault decompõe o modelo em hubs (chaves de negócio), links (relacionamentos, sempre modelados como many-to-many) e satellites (atributos e seu histórico, insert-only com hash diff). O objetivo é auditabilidade total e resiliência a mudança: como nada é atualizado ou deletado, você reconstrói o estado do dado em qualquer instante — inclusive o que a origem afirmou quando estava errada — e adicionar uma nova fonte significa acrescentar estruturas, não refatorar as existentes. As hash keys permitem carga totalmente paralela.

O ponto crucial é que Data Vault **não substitui** modelagem dimensional: ele fica na camada de integração, e você constrói star schemas em cima para consumo. Consultar o Vault diretamente é impraticável pelo volume de joins.

Eu usaria em contexto de muitas fontes heterogêneas e voláteis, exigência regulatória forte de auditoria, e várias equipes contribuindo para o mesmo warehouse. Não usaria numa empresa pequena com poucas fontes — a explosão de tabelas e a complexidade não se pagam.

*Follow-up:* "Qual o maior risco de adotar Data Vault?" → Custo de manutenção subestimado e disciplina de equipe. O modelo só entrega o valor prometido se as convenções forem seguidas com rigor; times que "quase" seguem Data Vault acabam com o pior dos dois mundos: complexidade alta e auditabilidade incompleta.

---

**🔴 P10. Uma dimensão precisa suportar tanto a visão histórica quanto a visão atual do mesmo atributo. Como você resolve?**

*Resposta modelo:* SCD Tipo 6 — híbrido. As linhas são versionadas como Tipo 2, preservando o valor vigente na época em uma coluna, e adicionalmente cada linha carrega colunas com o valor **atual** do atributo, atualizadas em todas as versões quando há mudança (comportamento Tipo 1 aplicado sobre uma estrutura Tipo 2). Isso permite responder na mesma consulta "quanto vendeu a região à qual o vendedor pertencia no momento da venda" e "quanto vendeu a região à qual ele pertence hoje", só trocando a coluna.

A alternativa é Tipo 7: a fato carrega tanto a surrogate key quanto a chave natural durável, e você expõe duas views — uma que junta pela surrogate (histórica) e outra que junta pela chave durável com a linha corrente (atual). Tipo 7 evita reescrever as linhas antigas a cada mudança, ao custo de uma fato mais larga e de disciplina no consumo.

*Follow-up esperado:* "Qual o custo do Tipo 6 em uma dimensão com milhões de linhas?" → Toda mudança exige atualizar todas as versões históricas daquela entidade, o que em engines colunares e formatos imutáveis (Parquet/Iceberg) significa reescrever arquivos inteiros. Em volume alto, Tipo 7 ou uma view calculada sobre Tipo 2 puro costumam sair mais barato.

---

**🔴 P11. Como você modelaria um relacionamento many-to-many entre fato e dimensão? Por exemplo, uma venda hospitalar com múltiplos diagnósticos.**

*Resposta modelo:* Com uma **bridge table** (tabela ponte). Em vez de a fato apontar direto para a dimensão de diagnóstico, ela aponta para uma chave de *grupo* de diagnósticos, e a bridge relaciona cada grupo aos diagnósticos individuais. Isso preserva o grão da fato — uma linha por atendimento — enquanto permite explodir para os diagnósticos quando necessário.

O problema clássico dessa estrutura é a **dupla contagem**: ao juntar fato → bridge → dimensão, o valor do atendimento aparece uma vez por diagnóstico, e um `SUM` ingênuo infla o total. A solução é adicionar um **fator de alocação (weighting factor)** na bridge, que distribui a métrica entre os membros do grupo somando 1.0 no total. Aí você tem duas leituras válidas e distintas: a alocada (soma corretamente, "quanto do custo é atribuível a cada diagnóstico") e a de impacto (não soma, "quanto custaram os atendimentos que envolveram esse diagnóstico"). Explicitar qual das duas o negócio quer é parte da resposta.

A alternativa simplória é achatar em colunas fixas (`diagnostico_1`, `diagnostico_2`, `diagnostico_3`), que só funciona se houver um limite baixo e estável, e que é péssima de consultar. Vale mencionar como o que **não** fazer.

---

**🔴 P12. Como você lida com late-arriving facts e late-arriving dimensions?**

*Resposta modelo:* São dois problemas distintos.

**Late-arriving fact** (o evento chega depois, mas a dimensão já existe): você precisa encontrar a versão da dimensão que estava **vigente na data do evento**, não a versão corrente. Isso significa que o lookup da surrogate key filtra por `data_evento BETWEEN data_inicio_validade AND data_fim_validade`, e não por `flag_atual = true`. Errar isso é o bug mais comum de carga de SCD Tipo 2 — e ele é silencioso, porque o resultado parece plausível.

**Late-arriving dimension / early-arriving fact** (o evento chega antes de a dimensão existir): você não pode descartar o fato nem deixar a FK nula. A solução padrão é criar uma **linha inferida (inferred member)** na dimensão, com a chave natural conhecida e os demais atributos preenchidos com valores default ou "desconhecido", marcada com uma flag de inferida. Quando a dimensão real chegar, você atualiza aquela linha (comportamento Tipo 1) em vez de criar uma nova, e desmarca a flag. Assim a fato nunca perde a ligação.

Um terceiro caso: a **mudança de dimensão chega atrasada**, com data de vigência anterior à linha corrente. Aí você precisa inserir a versão no meio do histórico e reajustar os intervalos de validade das linhas vizinhas — e, dependendo da política, reprocessar as fatos daquele período para reapontar as surrogate keys. É caro, e é por isso que vale definir explicitamente uma janela de tolerância (por exemplo, 7 dias) além da qual a correção retroativa não é feita automaticamente.

---

**🔴 P13. O star schema ainda faz sentido com engines colunares modernas e storage barato? Muita gente defende One Big Table.**

*Resposta modelo:* O trade-off mudou de peso, mas não desapareceu. Colunar mais compressão tornaram a redundância barata, e engines modernas fazem broadcast join de dimensões pequenas quase de graça — então o argumento "joins são caros" perdeu força para o caso comum.

O que OBT **não** resolve: quando um atributo de dimensão muda, você precisa reescrever a tabela inteira em vez de uma linha da dimensão, o que é caro e lento em volume alto. Você perde dimensões conformadas e, com elas, a capacidade de cruzar domínios de forma consistente — cada time cria a sua OBT, e as definições divergem. E você perde o ponto único de manutenção de definição de negócio.

Na prática, o padrão que eu defendo é star schema na camada modelada, com OBTs materializadas como camada de consumo para casos de uso específicos e de alto volume de acesso. Você mantém a governança do modelo dimensional e ganha a performance da desnormalização onde ela importa. Dizer que uma abordagem substitui a outra é o erro; elas ocupam camadas diferentes.

---

**🔴 P14. Você tem uma dimensão de cliente com 200 milhões de linhas e uns 10 atributos que mudam quase todo mês (score de crédito, faixa de gasto, segmento). SCD Tipo 2 nessa dimensão é viável?**

*Resposta modelo:* Não da forma ingênua. Com 200 milhões de clientes e mudança mensal em atributos voláteis, a dimensão cresceria ~2,4 bilhões de linhas por ano, o que é maior que muitas tabelas fato — isso é o sintoma clássico de **rapidly changing dimension** modelada errado.

A solução padrão é a **mini-dimensão** (SCD Tipo 4): separo os atributos voláteis numa dimensão própria, tipicamente convertendo valores contínuos em faixas (banding) — score vira faixa de score, gasto vira faixa de gasto. Isso limita a cardinalidade ao número de **combinações distintas** de faixas, que pode ser algo como dezenas de milhares em vez de bilhões. A tabela fato passa a referenciar duas chaves: a dimensão de cliente (com atributos estáveis, Tipo 2 normal) e a mini-dimensão (o perfil vigente no momento do evento).

Isso preserva a análise histórica — "quanto compraram os clientes que na época estavam na faixa alta de score" — sem explodir a dimensão. O custo é perda de granularidade dos atributos contínuos, e é uma conversa a ter com o negócio: as faixas precisam ser definidas por eles e mudá-las depois é doloroso.

Se o negócio exigir o valor exato e não a faixa, aí a alternativa é uma tabela de histórico separada (Tipo 4 clássico) consultada apenas quando necessário, com a dimensão principal mantendo só o estado corrente.

---

**🔴 P15. Como você decidiria o grão de uma tabela fato em um contexto ambíguo, e o que acontece se errar?**

*Resposta modelo:* A regra é escolher o **grão mais atômico** que a origem permite, não o grão que as perguntas atuais exigem. Se a origem tem item de pedido, modele item de pedido, mesmo que hoje todo mundo pergunte só no nível de pedido. Motivo: você sempre pode agregar para cima, nunca desagregar para baixo. Modelar no grão agregado é uma decisão irreversível sem reprocessar tudo.

As exceções são custo e volume: se o grão atômico gera petabytes e nenhuma pergunta plausível desce até lá, um snapshot agregado pode se justificar — mas isso deve ser uma decisão explícita e documentada, idealmente mantendo o dado atômico numa camada bruta para reprocessamento futuro.

Se errar para cima (grão agregado demais), você perde a capacidade de responder perguntas novas e precisa reprocessar da origem. Se errar para baixo (mais granular que o necessário), você paga custo de storage e compute desnecessário — que é um erro muito mais barato de corrigir. Na dúvida, erre para baixo.

O outro erro clássico é **misturar grãos na mesma tabela**: linhas de item de pedido junto com linhas de frete no nível do pedido. Isso quebra qualquer agregação e é notoriamente difícil de detectar, porque a tabela "parece" certa até alguém somar.

---

## 3. Armadilhas comuns

**Dizer que normalização serve para economizar espaço.** É o marcador mais rápido de quem decorou. Espaço é irrelevante em 2026; o objetivo é integridade e ausência de anomalias de atualização.

**Tratar SCD como propriedade da tabela.** O tipo de SCD é escolhido **por atributo**. A mesma `dim_cliente` pode ter `email` como Tipo 1 (correção) e `segmento` como Tipo 2 (histórico importa). Responder "essa dimensão é Tipo 2" sem qualificar mostra que você nunca implementou uma.

**Esquecer de declarar o grão.** Candidatos pulam direto para "essa é a fato de vendas, essas são as dimensões". Entrevistador vai perguntar "o que é uma linha aqui?" e a maioria hesita. Declare o grão como primeiro passo, sempre.

**Fazer lookup de dimensão pela linha corrente ao carregar fatos históricos.** Ao carregar um fato com data antiga, buscar `WHERE flag_atual = true` atribui o evento ao contexto errado. Tem que filtrar pelo intervalo de validade que contém a data do evento. É um bug silencioso: os números saem, só estão errados.

**Somar métricas semi-aditivas ao longo do tempo.** Somar saldos diários da mesma conta produz um número sem significado. Semi-aditivas exigem `LAST_VALUE` ou média no eixo tempo, e soma nos outros eixos.

**Armazenar percentuais e médias pré-calculadas na fato.** Média de médias e soma de percentuais estão errados sempre que os grupos têm tamanhos diferentes. Guarde numerador e denominador.

**Confundir snowflake com normalização da tabela fato.** Snowflake normaliza **dimensões**. A fato permanece intacta. Candidatos às vezes descrevem quebrar a fato em várias tabelas, o que não é snowflake — é outra coisa (e geralmente uma má ideia).

**Achar que Data Vault substitui star schema.** Ele fica na camada de integração; a camada de consumo continua sendo dimensional. Dizer "modelamos em Data Vault, então não precisamos de dimensional" indica que a pessoa leu sobre e não usou.

**Usar NULL em chave estrangeira da fato.** Sempre que a dimensão não é conhecida, aponte para uma linha especial (`-1 = desconhecido`). NULL em FK força LEFT JOIN, quebra contagens, e faz o dado "sumir" silenciosamente de relatórios que usam INNER JOIN.

**Modelar many-to-many achatando em colunas numeradas.** `categoria_1`, `categoria_2`, `categoria_3` parece prático e é uma armadilha: quebra assim que aparece um quarto valor, e consultar exige `OR` em todas as colunas. Use bridge table.

**Não perguntar sobre a intenção do negócio.** Muitas dessas perguntas não têm resposta certa sem contexto. "O negócio quer ver as vendas antigas pela estrutura antiga ou pela atual?" é uma pergunta que, feita na hora certa, vale mais que a resposta técnica. Entrevistadores frequentemente deixam ambiguidade de propósito, para ver se você a detecta.

**Ignorar a dimensão de data.** Quase todo modelo dimensional tem uma `dim_data` pré-populada com atributos de calendário (dia da semana, feriado, semana fiscal, trimestre). Candidatos esquecem de mencioná-la, e ela é a dimensão conformada mais universal que existe. Detalhe extra: ela normalmente usa uma surrogate key legível no formato `YYYYMMDD`, uma das poucas exceções à regra de "surrogate key sem significado", porque facilita particionamento e debug.
