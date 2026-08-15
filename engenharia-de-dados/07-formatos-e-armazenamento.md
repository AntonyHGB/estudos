# 07 — Formatos de Arquivo e Armazenamento

> Colunar vs linha · Parquet, ORC, Avro · Compressão e encoding · Particionamento físico · File sizing e small files · Object storage

Arquivo curto em relação aos outros, mas de alto retorno: ele explica *fisicamente* por que analytics moderno funciona, e permite responder com números concretos — o que impressiona.

---

## 1. Resumo conceitual

### 1.1 Orientação a linha vs orientação a coluna

**Orientado a linha**: os valores de um mesmo registro ficam fisicamente juntos. Ler um registro inteiro custa uma leitura sequencial.

**Orientado a coluna**: os valores de uma mesma coluna ficam fisicamente juntos. Ler uma coluna inteira custa uma leitura sequencial; ler um registro inteiro exige tocar em N lugares.

Três consequências decorrem disso, e são a resposta completa para "por que colunar é melhor em analytics":

**1. Menos I/O.** Uma consulta analítica típica lê poucas colunas de uma tabela larga. Se a tabela tem 200 colunas e a query usa 5, o formato colunar lê 2,5% dos dados; o formato de linha lê 100%. Isso sozinho já é um ganho de uma a duas ordens de grandeza, e é o efeito dominante.

**2. Compressão muito melhor.** Valores de uma mesma coluna têm o mesmo tipo e frequentemente valores repetidos ou próximos. Isso permite técnicas que não funcionam em dados heterogêneos: dictionary encoding (substituir strings repetidas por IDs pequenos), run-length encoding (armazenar "o valor X repete 5000 vezes"), delta encoding (armazenar diferenças em vez de valores absolutos, ótimo para timestamps e IDs sequenciais), e bit-packing (usar só os bits necessários para o range real). Taxas de 5:1 a 20:1 são comuns, contra 2:1 ou 3:1 em formato de linha.

**3. Execução vetorizada.** Como os valores de uma coluna são do mesmo tipo e contíguos em memória, a CPU processa em lote com instruções SIMD, e há muito menos cache miss e branch misprediction. Isso é um ganho de CPU, separado do ganho de I/O, e frequentemente esquecido nas respostas.

**Por que OLTP continua orientado a linha:** ler ou escrever um registro completo em formato colunar exigiria tocar em N regiões diferentes do disco. E atualizar uma linha significaria alterar N estruturas comprimidas. Formato colunar é hostil a escrita pontual e a leitura de registro inteiro — que são exatamente os dois padrões do OLTP.

### 1.2 Parquet, ORC e Avro

**Apache Parquet** — colunar, o padrão de fato em data lakes e lakehouses.
- Estrutura hierárquica: arquivo → **row groups** (blocos horizontais, tipicamente 128 MB–1 GB) → **column chunks** (uma coluna dentro do row group) → **pages** (unidade de compressão e encoding, tipicamente ~1 MB).
- Cada row group e cada page carrega **estatísticas**: min, max, contagem de nulos, e opcionalmente distinct count. É isso que permite ao engine pular blocos inteiros sem descomprimir — o mecanismo por trás do predicate pushdown eficiente.
- Suporta estruturas aninhadas (o algoritmo de definition/repetition levels do Dremel), permitindo representar JSON complexo mantendo colunaridade.
- Encodings: dictionary, RLE, delta, bit-packing, escolhidos automaticamente por coluna.
- Suporta **bloom filters** opcionais por coluna, que ajudam em predicados de igualdade sobre colunas de alta cardinalidade, onde min/max não filtram bem.

**Apache ORC** — colunar, conceitualmente muito próximo do Parquet.
- Organizado em **stripes** (equivalente aos row groups), com índices em três níveis: arquivo, stripe e **row group de 10 mil linhas**, o que dá um pruning mais fino que o Parquet em alguns casos.
- Historicamente mais integrado ao ecossistema Hive/Hadoop e com suporte nativo a ACID no Hive.
- Na prática, a diferença de performance entre ORC e Parquet é pequena e depende do caso; a decisão costuma ser ditada por qual o ecossistema suporta melhor. Parquet venceu em adoção fora do mundo Hive.

**Apache Avro** — **orientado a linha**, e esse é o ponto.
- Schema em JSON armazenado junto com os dados, com regras de **evolução de schema** bem definidas (compatibilidade forward, backward e full).
- Serialização binária compacta e rápida.
- Como é orientado a linha, é bom para **escrita** e para **transporte de registros completos**, não para consulta analítica seletiva.
- É o formato natural para mensagens em Kafka (com Schema Registry), para camada de ingestão bruta, e para casos onde você sempre lê o registro inteiro.

**A regra prática que responde a maioria das perguntas:** Avro para escrever e transportar, Parquet/ORC para ler e analisar. Um pipeline típico ingere em Avro (ou JSON) e converte para Parquet na camada analítica.

**JSON e CSV** merecem menção pelo que têm de ruim: sem tipos (ou com tipos frouxos), sem compressão eficiente, sem estatísticas, sem schema aplicado, e caros de parsear. CSV tem ainda ambiguidades de escaping, encoding e delimitador que causam bugs reais. São formatos de **interchange**, aceitáveis na borda do sistema, nunca como camada de armazenamento analítico. Um detalhe técnico relevante: CSV e JSON não são **splittable** quando comprimidos com gzip, o que impede paralelizar a leitura de um arquivo grande — um único arquivo .csv.gz de 50 GB é processado por uma única task.

### 1.3 Compressão

Dois eixos de decisão: **taxa de compressão** versus **velocidade de compressão/descompressão**, e **splittability**.

- **Snappy**: rápido, taxa moderada. Foi por muito tempo o padrão em Parquet, porque o gargalo costumava ser CPU e não I/O.
- **Zstd (zstandard)**: taxa significativamente melhor que Snappy com velocidade competitiva, e nível ajustável. Tornou-se a escolha preferida na maioria dos casos modernos, especialmente quando o storage é cobrado por byte e a rede é o gargalo.
- **Gzip**: taxa boa, descompressão lenta. E, no nível de arquivo inteiro, não é splittable.
- **LZ4**: muito rápido, taxa baixa. Bom para dados intermediários e shuffle.
- **Brotli**: taxa alta, compressão lenta. Bom para dados escritos uma vez e lidos muitas.

**Splittability** é o conceito que mais cai. Um arquivo é splittable quando o engine consegue começar a ler do meio dele, permitindo que várias tasks processem partes diferentes do mesmo arquivo em paralelo. Um CSV comprimido com gzip **não é splittable**, porque você precisa descomprimir desde o início para chegar ao meio — então um arquivo de 50 GB vira uma única task, independentemente do tamanho do cluster.

Parquet e ORC contornam isso porque a compressão é aplicada **por página/bloco interno**, não ao arquivo inteiro. Cada row group pode ser lido independentemente, então o arquivo é splittable mesmo com gzip nas páginas. Explicar isso corretamente é um bom diferencial.

**Compressão e formato interagem:** a taxa que você obtém em Parquet vem majoritariamente do *encoding* colunar (dictionary, RLE, delta), não do algoritmo de compressão genérico aplicado depois. Ordenar os dados por uma coluna de baixa cardinalidade antes de escrever pode melhorar dramaticamente a compressão, porque cria longas sequências de valores repetidos que o RLE captura. Isso é uma alavanca real e pouco usada.

### 1.4 Particionamento físico e pruning

Particionar em disco significa organizar os arquivos em diretórios por valor de uma coluna:

```
/vendas/ano=2026/mes=08/dia=14/part-0001.parquet
```

O ganho é **partition pruning**: uma consulta que filtra por data lê apenas os diretórios relevantes, sem abrir os demais arquivos. Em tabelas grandes, isso é a diferença entre segundos e horas.

**Como escolher a coluna de partição:**
- Deve aparecer nos filtros da maioria das consultas (senão não serve para nada).
- Cardinalidade moderada. Data é o caso ideal.
- Distribuição razoavelmente uniforme.

**Sobre-particionamento é um erro tão comum quanto sub-particionamento.** Particionar por `ano/mes/dia/hora/user_id` gera milhões de diretórios com arquivos minúsculos. Consequências: listar os objetos vira lento e caro (em object storage, listagem é uma operação de API, e milhões de chamadas custam tempo e dinheiro); o metadado da tabela incha; o planejamento da query passa a demorar mais que a execução; e cada arquivo pequeno tem overhead fixo de abertura e de leitura de footer.

**Regras práticas úteis para citar em entrevista:**
- Mire partições de **algumas centenas de MB a poucos GB**.
- Mantenha o número total de partições na casa de **milhares**, não de milhões.
- Se uma partição típica tem menos de ~100 MB, você está particionando fino demais — suba um nível de granularidade (de dia para mês, por exemplo).

**Para a segunda dimensão de filtro, use clustering em vez de mais um nível de partição.** Clustering (ou sort key, ou Z-ordering) ordena fisicamente os dados dentro do arquivo por uma ou mais colunas, o que estreita os intervalos de min/max por bloco e melhora muito o pruning por estatística — sem criar diretórios. Z-ordering é uma curva de preenchimento de espaço que preserva localidade em **múltiplas** dimensões simultaneamente, sendo útil quando as consultas filtram por combinações variáveis de duas ou três colunas.

Formatos de tabela modernos ainda adicionam duas melhorias importantes sobre o modelo Hive: **hidden partitioning** (a partição é derivada de uma coluna real por transformação declarada, então o usuário filtra pela coluna natural e o pruning acontece automaticamente) e **partition evolution** (mudar o esquema de particionamento sem reescrever dados históricos).

### 1.5 O problema dos small files

É o problema operacional mais comum em data lakes, e um dos que mais aparece em entrevistas práticas.

**Como surge:** ingestão frequente (um job a cada 5 minutos gera 288 arquivos por dia por partição); streaming com micro-batches curtos; paralelismo alto na escrita (200 tasks escrevendo geram 200 arquivos por partição); ou particionamento fino demais.

**Por que dói:**
- **Overhead por arquivo.** Cada arquivo Parquet exige abrir, ler o footer com o schema e as estatísticas, e depois ler os dados. Com arquivos de 1 MB, o overhead domina o trabalho útil.
- **Listagem cara.** Em object storage, listar objetos é uma chamada de API paginada. Milhões de objetos significam milhares de chamadas antes de a query começar.
- **Compressão pior.** Dictionary e RLE precisam de volume para serem eficazes; arquivos pequenos têm dicionários pequenos e razão de compressão ruim.
- **Estatísticas menos úteis.** Menos linhas por bloco significa intervalos de min/max menos discriminantes.
- **Metadados inchados** no catálogo e no formato de tabela, degradando o planejamento.
- Historicamente, o NameNode do HDFS guardava metadados em memória, então arquivos pequenos eram um limite físico do cluster — vale mencionar como contexto se o assunto for Hadoop.

**Como resolver:**
- **Compactação periódica** (compaction / `OPTIMIZE`): reescrever muitos arquivos pequenos em poucos grandes. É uma tarefa de manutenção de primeira classe, com custo e agendamento próprios — não um detalhe.
- **Controlar o paralelismo da escrita.** Fazer `coalesce`/`repartition` antes de gravar, para que o número de arquivos por partição seja intencional e não um acidente do número de tasks.
- **Agrupar micro-batches.** Escrever a cada 30 minutos em vez de a cada minuto, quando a latência permite.
- **Repensar o particionamento**, se ele é a causa raiz.
- **Padrão de duas camadas**: uma tabela de ingestão otimizada para escrita (arquivos pequenos, latência baixa) e uma tabela servida otimizada para leitura, alimentada por um processo de compactação. É o mesmo espírito do Merge-on-Read.

**Tamanho alvo:** a faixa comumente recomendada é **128 MB a 1 GB** por arquivo, com row groups de 128 a 512 MB. O limite superior importa porque row group grande demais aumenta o consumo de memória na leitura (o engine lê o row group inteiro para uma coluna) e reduz a granularidade do pruning.

### 1.6 Object storage: o que muda

Data lakes e lakehouses rodam sobre object storage (S3, GCS, ADLS), que **não é um sistema de arquivos**, e as diferenças importam:

- **Não há diretórios de verdade.** "Pastas" são prefixos no nome do objeto. Listar por prefixo é uma operação de API, não uma leitura de inode — daí o custo de listagem.
- **Objetos são imutáveis.** Você não altera parte de um objeto; você o substitui inteiro. É por isso que UPDATE e DELETE em data lake exigem reescrever arquivos ou usar delete files.
- **Rename não é atômico nem barato.** Em sistemas de arquivos, rename é uma operação de metadado. Em object storage, é copiar e deletar. Isso quebrou os commit protocols originais do Hadoop, que dependiam de rename atômico de diretório — e é uma das razões da existência dos formatos de tabela.
- **Latência alta por requisição, throughput agregado altíssimo.** A estratégia certa é fazer menos requisições maiores e em paralelo, não muitas pequenas. Isso reforça tudo que foi dito sobre small files.
- **Consistência.** Os principais provedores hoje oferecem consistência forte de leitura após escrita, mas historicamente havia consistência eventual em listagem, o que causava bugs sutis (o job escrevia arquivos e a listagem seguinte não os via). Vale conhecer como contexto histórico.
- **Classes de armazenamento e ciclo de vida.** Dados frios podem migrar para camadas mais baratas com latência de recuperação maior. Definir política de ciclo de vida é parte da engenharia de custo e frequentemente é a alavanca de economia mais fácil que existe.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Qual a diferença entre armazenamento em linha e colunar?**

*Resposta modelo:* Em formato de linha, os valores de um registro ficam fisicamente juntos; em colunar, os valores de uma mesma coluna ficam juntos. Isso significa que consulta analítica, que lê poucas colunas de muitas, lê só o necessário no formato colunar — se a tabela tem 200 colunas e a query usa 5, você lê 2,5% dos dados. Além disso, valores do mesmo tipo e domínio na mesma coluna comprimem muito melhor, e a CPU processa em lote com instruções vetorizadas.

Formato de linha continua melhor em OLTP, porque lá você lê e escreve o registro inteiro, e atualizar uma linha em colunar exigiria mexer em N estruturas comprimidas.

---

**🟢 P2. Quando usar Parquet e quando usar Avro?**

*Resposta modelo:* Parquet é colunar: use para armazenamento analítico, onde as consultas leem poucas colunas de muitas linhas. Avro é orientado a linha, com schema embutido e regras claras de evolução: use para transporte de registros completos e para escrita — mensagens em Kafka, camada de ingestão bruta, casos onde você sempre lê o registro inteiro.

A regra prática é: Avro para escrever e transportar, Parquet para ler e analisar. Um pipeline típico ingere em Avro ou JSON e converte para Parquet na camada analítica.

---

**🟢 P3. Por que arquivos pequenos são um problema num data lake?**

*Resposta modelo:* Porque o overhead por arquivo passa a dominar. Cada arquivo exige abrir, ler o footer com schema e estatísticas, e só então ler dados — com arquivos de 1 MB, o custo fixo é maior que o trabalho útil. Em object storage, listar milhões de objetos é uma sequência de chamadas de API que atrasa a query antes mesmo de ela começar. A compressão fica pior, porque dictionary e RLE precisam de volume. E as estatísticas por bloco ficam menos discriminantes, reduzindo o pruning.

A solução é compactação periódica, controlar o paralelismo da escrita, e revisar o particionamento se ele for a causa.

---

**🟢 P4. O que é partition pruning?**

*Resposta modelo:* É o engine pular arquivos ou diretórios inteiros que não podem conter linhas que satisfaçam o filtro, sem lê-los. Se a tabela é particionada por data e a query filtra um mês, ele lê 30 diretórios em vez de milhares. É o maior ganho isolado de performance disponível em tabelas grandes.

O detalhe importante é que ele só acontece se o predicado for utilizável: aplicar uma função sobre a coluna de partição, ou ter incompatibilidade de tipo, impede o pruning e força varredura completa — e isso falha silenciosamente, a query devolve o resultado certo, só que caríssima.

---

### 🟡 Intermediário

**🟡 P5. Como o Parquet consegue pular dados sem ler tudo?**

*Resposta modelo:* Pela estrutura hierárquica e pelas estatísticas. Um arquivo Parquet é dividido em row groups; dentro de cada row group, cada coluna é um column chunk, subdividido em pages. Cada nível carrega estatísticas — min, max e contagem de nulos.

Quando a query filtra por `valor > 1000`, o engine lê o footer, verifica as estatísticas de cada row group e descarta aqueles cujo máximo é menor ou igual a 1000, sem descomprimir nada. Isso é o predicate pushdown operando no nível do formato.

O ganho depende de os dados estarem **ordenados ou agrupados** pela coluna filtrada. Se os valores estiverem espalhados aleatoriamente, todo row group terá min baixo e max alto, e nenhum será descartado — as estatísticas ficam inúteis. É por isso que clustering ou sort na escrita importa tanto: ele estreita os intervalos e torna as estatísticas discriminantes. Parquet também suporta bloom filters por coluna, que ajudam em igualdade sobre alta cardinalidade, onde min/max não filtram bem.

---

**🟡 P6. O que é splittability e por que importa?**

*Resposta modelo:* Um arquivo é splittable quando o engine consegue começar a ler do meio, permitindo que várias tasks processem partes diferentes em paralelo. Importa porque define se o paralelismo do cluster pode ser usado num arquivo grande.

Um CSV comprimido com gzip não é splittable: para chegar ao meio você precisa descomprimir desde o início. Um arquivo de 50 GB nesse formato vira uma única task, independentemente do tamanho do cluster — é um gargalo que nenhum ajuste de configuração resolve.

Parquet e ORC contornam isso porque comprimem por página interna, não o arquivo inteiro, então cada row group é lido independentemente e o arquivo permanece splittable mesmo com um algoritmo que não seria splittable sozinho.

---

**🟡 P7. Snappy, Zstd ou gzip? Como você escolhe?**

*Resposta modelo:* Pelo eixo taxa versus velocidade, e por quem é o gargalo.

Snappy é rápido com taxa moderada, e foi o padrão histórico do Parquet quando CPU era o gargalo. Zstd dá taxa significativamente melhor com velocidade competitiva e nível ajustável, e virou a escolha preferida na maior parte dos casos modernos — especialmente quando você paga por byte armazenado e transferido, porque a economia de storage e de rede compensa o pouco de CPU adicional. Gzip tem taxa boa mas descompressão lenta. LZ4 é para dados intermediários e shuffle, onde velocidade domina.

E acrescentaria uma coisa que costuma render mais que a escolha do algoritmo: em Parquet, a maior parte da compressão vem do encoding colunar — dictionary, RLE, delta — não do compressor genérico. Ordenar os dados por uma coluna de baixa cardinalidade antes de gravar cria longas sequências repetidas que o RLE captura, e pode melhorar a taxa mais do que trocar de algoritmo.

---

**🟡 P8. Qual o tamanho ideal de arquivo e por quê?**

*Resposta modelo:* A faixa que eu miro é 128 MB a 1 GB por arquivo, com row groups entre 128 e 512 MB.

O limite inferior existe porque abaixo disso o overhead por arquivo — abertura, leitura de footer, chamada de API — passa a dominar, e a compressão piora. O limite superior existe porque o engine lê o row group inteiro de uma coluna para processá-lo, então row groups muito grandes aumentam o consumo de memória e reduzem a granularidade do pruning: um row group de 5 GB tem estatísticas menos discriminantes que dez de 500 MB.

Na prática eu ajustaria pelo padrão de acesso: leitura muito seletiva favorece arquivos e row groups menores para pruning fino; varredura completa favorece arquivos maiores para reduzir overhead.

---

**🟡 P9. Como você decidiria entre particionar por mais uma coluna ou usar clustering?**

*Resposta modelo:* Particionamento físico cria diretórios e é ótimo para a dimensão principal de filtro — tipicamente tempo. Mas cada nível adicional multiplica o número de diretórios e leva a arquivos pequenos, então ele não escala para várias dimensões.

Para a segunda e terceira dimensões, uso clustering: ordenar fisicamente os dados dentro dos arquivos por essas colunas. Isso estreita os intervalos de min/max por bloco e melhora muito o pruning por estatística, sem criar diretórios nem fragmentar arquivos.

Z-ordering é a variante para múltiplas dimensões simultâneas: uma curva de preenchimento de espaço que preserva localidade em duas ou três colunas ao mesmo tempo, útil quando as consultas filtram por combinações variáveis. O custo é que ele é subótimo para cada dimensão isolada comparado a ordenar só por ela — é um compromisso entre dimensões, e só vale quando o padrão de consulta é realmente misto.

Regra prática: particione pela dimensão que aparece em quase toda consulta; clusterize pelas que aparecem em algumas.

---

### 🔴 Avançado

**🔴 P10. Um pipeline de streaming está gerando milhões de arquivos pequenos. Como resolver sem aumentar a latência?**

*Resposta modelo:* O conflito é real: latência baixa exige commits frequentes, e commits frequentes geram arquivos pequenos. Não dá para resolver só ajustando um lado.

A solução estrutural é **separar as duas responsabilidades em duas camadas**. Uma tabela de ingestão otimizada para escrita, com commits frequentes e arquivos pequenos, servindo quem precisa de dado fresco. E uma tabela servida otimizada para leitura, alimentada por um processo de compactação que roda periodicamente e consolida. Quem precisa de latência lê a primeira; quem precisa de performance de varredura lê a segunda. É o mesmo espírito do Merge-on-Read.

Complementarmente, três ajustes: **controlar o paralelismo da escrita** — frequentemente o número de arquivos é acidental, resultado de N tasks escrevendo, e um `coalesce` antes da gravação já reduz drasticamente sem afetar latência. **Revisar o particionamento**, porque particionamento fino multiplica o problema: com partição por hora e 200 tasks, são 4.800 arquivos por dia por definição. E **agrupar micro-batches** até o limite que o requisito de latência permite — de 1 para 5 minutos frequentemente é imperceptível para o usuário e reduz o número de arquivos em 5 vezes.

A compactação precisa ser tratada como job de primeira classe: tem custo de compute, precisa de monitoramento, e em formato transacional precisa lidar com concorrência contra os writers. Deixá-la implícita é como esse problema chega ao estado de milhões de arquivos.

---

**🔴 P11. Por que ordenar os dados antes de escrever pode melhorar drasticamente a performance de leitura?**

*Resposta modelo:* Por dois mecanismos que se somam.

**Compressão.** Encodings colunares dependem de repetição local. Se os dados estão ordenados por uma coluna de baixa cardinalidade, aquela coluna vira longas sequências do mesmo valor, que o run-length encoding representa em quase nada. Colunas correlacionadas com ela também melhoram. Já vi reduções de 40% ou mais no tamanho da tabela só por ordenar antes de gravar.

**Pruning por estatística.** As estatísticas de min/max por row group só filtram se os intervalos forem estreitos. Com dados aleatórios, todo row group tem min baixo e max alto, e o engine não consegue descartar nenhum — as estatísticas existem mas são inúteis. Ordenado, cada row group cobre uma faixa estreita, e uma consulta seletiva descarta a maioria deles sem ler.

O custo é a ordenação na escrita, que exige um shuffle e é cara. Então vale quando a tabela é escrita uma vez e lida muitas — que é o caso da maioria das tabelas analíticas. Por isso `OPTIMIZE ... ZORDER BY` e comandos equivalentes existem: eles reescrevem os dados ordenados como operação de manutenção, amortizando o custo entre muitas leituras.

---

**🔴 P12. Explique como funciona a evolução de schema em Parquet e em Avro. Quais são os limites?**

*Resposta modelo:* São modelos diferentes.

**Avro** foi projetado em torno disso. O schema é armazenado com os dados, e a leitura usa dois schemas: o de escrita (writer) e o de leitura (reader), resolvidos por regras explícitas de compatibilidade. Adicionar campo com valor default é backward compatible — leitores novos leem dados antigos. Remover campo que tinha default é forward compatible — leitores antigos leem dados novos. Isso é o que torna Avro adequado para mensageria de longa vida, e é a base do funcionamento de um Schema Registry.

**Parquet** guarda o schema no footer de cada arquivo, e a evolução é gerenciada pela camada acima. Adicionar coluna funciona: arquivos antigos não a têm e o engine devolve NULL. Remover é ignorar na leitura. Mas **renomear e mudar tipo** são os problemas: se a resolução é por nome, renomear equivale a remover e adicionar, e você perde os dados históricos daquela coluna silenciosamente.

É exatamente por isso que formatos de tabela como Iceberg rastreiam colunas por **ID** e não por nome ou posição: renomear vira uma mudança de metadado, sem tocar nos arquivos, e reordenar colunas é seguro. Sem essa camada, evolução de schema em Parquet puro é frágil.

Os limites que permanecem em ambos: mudança de tipo incompatível (string para int) exige reescrita ou uma coluna nova; alterar a semântica de um campo sem mudar o tipo não é detectável por nenhum mecanismo automático — o schema continua válido e os dados ficam errados. Esse último caso é o argumento para contratos de dados com semântica documentada, não só schema.

---

**🔴 P13. Como você reduziria o custo de armazenamento de um data lake de 5 PB?**

*Resposta modelo:* Eu atacaria em cinco frentes, na ordem de retorno sobre esforço.

**Primeiro, dado que ninguém usa.** Logs de acesso do storage mostram o que não é lido há meses. Em qualquer lake grande, uma fração significativa é dado morto: tabelas de experimentos abandonados, cópias intermediárias que viraram permanentes, backups de migrações antigas. Deletar ou arquivar isso costuma ser a maior economia disponível, e é a primeira coisa a fazer — não faz sentido otimizar o formato de dado que não deveria existir.

**Segundo, política de ciclo de vida.** Migrar dado frio para classes mais baratas automaticamente, com base em idade e padrão de acesso. É configuração, não engenharia, e o retorno é imediato.

**Terceiro, compressão e formato.** Se ainda houver JSON ou CSV parados no lake, converter para Parquet com Zstd tipicamente reduz de 5 a 10 vezes. E, dentro do Parquet, ordenar por colunas de baixa cardinalidade antes de gravar melhora a taxa substancialmente.

**Quarto, retenção e manutenção do formato de tabela.** Snapshots antigos e arquivos órfãos acumulam silenciosamente e podem representar uma fração grande do volume total. Expiração de snapshots e limpeza de órfãos precisam estar agendadas. E compactação, além de performance, reduz overhead de metadado.

**Quinto, duplicação.** Em lakes grandes é comum a mesma tabela existir em três lugares porque três times a copiaram. Consolidar exige governança e conversa, mas o volume envolvido costuma ser grande.

E eu mediria antes de agir: quebrar o custo por prefixo, por time e por tabela, e atacar o topo da lista. Sem isso, o esforço se dispersa em otimizações que afetam 2% do volume. Também alinharia com o negócio o que é exigência regulatória de retenção — porque nessa parte a economia não está disponível, e descobrir isso depois de deletar é o pior resultado possível.

---

**🔴 P14. Quais são as implicações de object storage não ser um sistema de arquivos?**

*Resposta modelo:* Quatro implicações práticas.

**Não há diretórios.** "Pastas" são prefixos no nome do objeto, e listar por prefixo é uma chamada de API paginada, não uma leitura de metadado local. É por isso que milhões de arquivos pequenos degradam a query antes mesmo de ela começar a ler dados.

**Objetos são imutáveis.** Não se altera parte de um objeto; substitui-se inteiro. É a razão física de UPDATE e DELETE em data lake exigirem reescrever arquivos (copy-on-write) ou registrar deltas (merge-on-read).

**Rename não é atômico nem barato** — é copiar e deletar. Isso quebrou os commit protocols originais do Hadoop, que dependiam de rename atômico de diretório para publicar resultados. É uma das razões de existirem formatos de tabela: eles substituem o rename por um commit de metadado.

**Latência alta por requisição, throughput agregado altíssimo.** A estratégia certa é fazer poucas requisições grandes e muitas em paralelo, não muitas pequenas em série. Isso justifica os tamanhos-alvo de arquivo e explica por que leitura com muitas requisições pequenas é desproporcionalmente lenta.

Vale acrescentar que historicamente havia consistência eventual na listagem, o que causava bugs em que um job escrevia arquivos e a listagem seguinte não os enxergava. Os principais provedores hoje oferecem consistência forte após escrita, mas o padrão arquitetural de não confiar em listagem para determinar o conteúdo de uma tabela — e usar um manifesto explícito — permanece correto, e é o que formatos de tabela fazem.

---

## 3. Armadilhas comuns

**Dizer que colunar é rápido "porque é otimizado para leitura", sem explicar.** A resposta precisa citar os três mecanismos: menos I/O por ler só as colunas necessárias, compressão muito melhor por homogeneidade, e execução vetorizada.

**Confundir Avro com formato colunar.** Avro é orientado a linha. É um erro frequente e revela que a pessoa só decorou uma lista de "formatos de big data".

**Achar que Parquet resolve tudo sozinho.** Sem dados ordenados ou clusterizados, as estatísticas de min/max não filtram nada e o pruning não acontece. O formato dá a capacidade; o layout determina se ela é usada.

**Ignorar splittability.** Propor CSV+gzip para arquivos grandes cria um gargalo de uma única task que nenhuma configuração de cluster resolve.

**Particionar por coluna de alta cardinalidade.** `user_id` ou `id_transacao` como partição gera milhões de diretórios com arquivos minúsculos. É o erro de particionamento mais comum.

**Tratar compactação como opcional.** Sem ela, o lake degrada continuamente. É trabalho de manutenção recorrente, com custo e monitoramento próprios.

**Esquecer o custo de listagem em object storage.** Muita gente raciocina como se fosse um sistema de arquivos local. A operação de listar é cara e é frequentemente o gargalo invisível.

**Assumir que renomear coluna em Parquet é seguro.** Sem uma camada que rastreie colunas por ID, renomear equivale a apagar e criar, e os dados históricos daquela coluna somem silenciosamente.

**Escolher o compressor antes de olhar o encoding e a ordenação.** O ganho de ordenar os dados antes de gravar frequentemente supera qualquer troca de algoritmo de compressão.

**Não ter política de retenção de snapshots.** Time travel retém arquivos que seriam deletados. Sem expiração, o storage cresce indefinidamente e o metadado degrada o planejamento das queries.

**Usar `SELECT *` em tabela colunar.** Anula o column pruning, que é justamente a maior vantagem do formato.
