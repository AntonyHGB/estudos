# 11 — Qualidade de Dados, Governança, Lineage e LGPD/GDPR

> Dimensões de qualidade · Testes e observabilidade · Contratos de dados · Lineage · Catálogo e ownership · LGPD, GDPR e PII · Anonimização

Este é o tópico que separa "pessoa que escreve pipeline" de "engenheiro de dados". Vagas sênior cobram; vagas em setor regulado (banco, saúde, seguro, telecom) cobram muito.

---

## 1. Resumo conceitual

### 1.1 Por que qualidade é problema de engenharia, não de análise

A intuição errada é que qualidade é responsabilidade de quem consome o dado — o analista descobre um número estranho e reporta. O problema desse modelo é o **tempo de detecção**: se o erro é descoberto quando alguém questiona um número, ele já circulou por dias, já embasou decisões, e já destruiu confiança.

E confiança é o ativo real de uma plataforma de dados. Uma vez perdida, os times constroem suas próprias planilhas paralelas, e você passa a ter N versões da verdade — que é o problema que a plataforma existia para resolver. Recuperar confiança é muito mais caro que mantê-la.

Por isso a qualidade tem que ser **verificada no pipeline, antes da publicação**, e não auditada depois.

### 1.2 As dimensões de qualidade

Vocabulário padrão, e vale saber nomear:

- **Completude**: os dados que deveriam estar lá estão? Faltam registros, faltam campos obrigatórios?
- **Acurácia**: os valores refletem a realidade? É a dimensão mais difícil, porque exige uma referência externa.
- **Consistência**: os dados concordam entre si e entre sistemas? A soma dos itens bate com o total do pedido? O warehouse bate com o sistema de origem?
- **Unicidade**: há duplicatas? A chave é realmente única?
- **Validade / conformidade**: os valores respeitam o formato, o tipo e o domínio esperados? CPF com dígito verificador válido, status dentro do conjunto permitido, valor não negativo?
- **Atualidade (timeliness/freshness)**: o dado está disponível quando deveria? Um dado correto que chega tarde demais é inútil.
- **Integridade referencial**: as chaves estrangeiras apontam para registros existentes?

Duas dimensões que candidatos esquecem e que rendem pontos:

- **Precisão/granularidade**: o dado está no nível de detalhe necessário?
- **Interpretabilidade / semântica**: o campo significa o que as pessoas acham que significa? Esse é o problema mais insidioso, porque nenhum teste automático o detecta — o schema é válido, os valores são plausíveis, e o número está errado porque "receita" significa coisas diferentes para dois times.

### 1.3 Testes de qualidade: como e onde

**Testes na ingestão (schema e contrato).** O dado que chega tem as colunas e tipos esperados? Falhar aqui é muito melhor que deixar o problema se propagar por dez camadas. É o "shift left" da qualidade.

**Testes sobre o resultado da transformação.** Os clássicos, que valem citar por nome:
- **Unicidade** da chave primária.
- **Not null** em campos obrigatórios.
- **Valores aceitos** (o status está no conjunto válido).
- **Integridade referencial** contra a dimensão.
- **Faixa de valores** (idade entre 0 e 120, valor não negativo).
- **Volume de linhas** dentro do esperado — comparado com o mesmo dia da semana anterior, não com ontem, porque sazonalidade semanal é forte na maioria dos negócios.
- **Reconciliação** contra a origem em métricas-chave: a soma da receita no warehouse bate com a soma na origem?
- **Distribuição**: a proporção de cada categoria mudou drasticamente? Isso pega mudanças silenciosas na origem que nenhum teste de schema detecta.

**Onde os testes rodam importa tanto quanto o que testam.** O padrão correto é **write-audit-publish**: escreve o resultado num local temporário, roda as validações contra ele, e publica atomicamente só se passar. Assim o dado ruim nunca fica visível. O antipadrão é publicar e depois auditar — quando o alerta chega, alguém já usou o número.

**Severidade importa.** Nem todo teste deve bloquear a publicação. Uma classificação útil:
- **Bloqueante**: quebra de invariante estrutural (chave duplicada, FK órfã, volume 90% abaixo do esperado). Para o pipeline.
- **Alerta**: desvio estatístico que merece investigação mas não invalida o dado.
- **Informativo**: métrica monitorada ao longo do tempo.

Sem essa classificação, uma de duas coisas acontece: ou tudo bloqueia e as pessoas começam a desligar testes para o pipeline rodar, ou nada bloqueia e os alertas viram ruído ignorado. Ambas terminam no mesmo lugar.

### 1.4 Observabilidade de dados

Qualidade testa **regras que você sabe escrever**. Observabilidade detecta **o que você não previu**, monitorando o comportamento do dado ao longo do tempo. Os cinco pilares usualmente citados:

- **Freshness**: quando o dado foi atualizado pela última vez?
- **Volume**: quantas linhas chegaram, comparado ao histórico?
- **Schema**: a estrutura mudou?
- **Distribuição**: os valores estão dentro do padrão histórico (média, desvio, nulos, cardinalidade)?
- **Lineage**: o que depende do quê, para avaliar impacto e rastrear causa.

A diferença prática: um teste falha quando você previu a regra. Observabilidade dispara quando algo *mudou* — a taxa de nulos numa coluna saltou de 0,1% para 12%, sem que ninguém tenha escrito um teste para aquela coluna. É complementar, não substituto, e a combinação é o que dá cobertura real.

O risco da observabilidade automatizada é **alerta demais**. Detecção de anomalia sobre centenas de colunas gera ruído que ninguém lê. Ela precisa ser calibrada e priorizada por criticidade das tabelas.

### 1.5 Contratos de dados

Um **contrato de dados** é um acordo explícito e versionado entre quem produz e quem consome um dataset. O que ele contém:

- **Schema**: campos, tipos, obrigatoriedade.
- **Semântica**: o que cada campo significa, em português claro. Esta parte é a que mais falta e a que mais causa problema.
- **Garantias de qualidade**: unicidade, faixas, regras de validade.
- **SLA**: frequência de atualização, latência máxima, janela de disponibilidade.
- **Política de evolução**: o que pode mudar, com quanto aviso, e qual o modo de compatibilidade.
- **Ownership**: quem é responsável e como acioná-lo.
- **Classificação de sensibilidade**: contém PII? Qual o nível de restrição?

**O problema que resolve:** sem contrato, o time de dados constrói pipelines sobre tabelas internas de aplicações que nunca prometeram estabilidade. Um desenvolvedor renomeia uma coluna numa refatoração legítima e quebra dez dashboards sem saber que eles existiam. O contrato torna a dependência **visível e negociada**, e transfere a responsabilidade de compatibilidade para o produtor.

**O que faz um contrato funcionar:** ele precisa ser **verificado automaticamente**, não ser um documento. Na prática isso significa: validação em CI do lado do produtor (a mudança quebra o contrato? o build falha), validação na ingestão do lado do consumidor, e — em mensageria — um Schema Registry com modo de compatibilidade configurado, que é a implementação técnica mais direta do conceito.

**A parte difícil não é técnica, é organizacional.** Contrato implica que o time de aplicação assume responsabilidade por consumidores analíticos, o que exige acordo de prioridade e frequentemente incentivo. Um contrato que o produtor não se sente responsável por cumprir é só documentação. Reconhecer isso numa entrevista é sinal de senioridade.

### 1.6 Lineage

**Lineage** é o mapa de origem e transformação: de onde este dado veio, por quais processos passou, e o que depende dele.

Dois níveis:
- **Table-level**: esta tabela deriva daquelas.
- **Column-level**: esta coluna deriva daquelas colunas, por esta transformação. Muito mais útil e mais difícil de manter.

**Para que serve, concretamente:**
- **Análise de impacto**: vou mudar esta tabela — o que quebra? Sem lineage, você descobre em produção.
- **Análise de causa raiz**: este número está errado — de onde veio? Sem lineage, é arqueologia.
- **Compliance**: onde estão os dados pessoais de um titular, em todas as cópias derivadas? Sem lineage, atender um pedido de exclusão sob LGPD é impossível de garantir.
- **Priorização e descomissionamento**: esta tabela alimenta o relatório do conselho ou é um experimento abandonado? Isso decide o que merece SLA e o que pode ser deletado.

**Como se obtém:** parsing de SQL e de planos de execução (automático, cobertura boa, mas cega a lógica em código customizado); instrumentação dos frameworks (padrões como OpenLineage); metadados declarados pelo desenvolvedor (preciso mas depende de disciplina, e envelhece); e integração nativa em ferramentas que já conhecem as dependências, como dbt e Dagster.

O ponto realista: lineage automático raramente é completo. Ele perde o que acontece dentro de UDFs, de código Python arbitrário, e de sistemas fora da plataforma. Lineage parcial ainda é muito útil — mas apresentá-lo como completo é perigoso, principalmente em compliance.

### 1.7 Governança, catálogo e ownership

**Catálogo de dados** é o inventário: quais datasets existem, o que significam, quem é dono, qual a sensibilidade, quando foram atualizados, quem os usa. Sem catálogo, você tem um data swamp por definição — o dado existe mas não é encontrável nem interpretável.

O que faz um catálogo funcionar (e a maioria falha aqui): ele precisa ser **alimentado automaticamente** e ter **valor imediato para quem consulta**. Catálogos que dependem de preenchimento manual de documentação ficam desatualizados em três meses e param de ser consultados, o que reforça o abandono. Metadados técnicos (schema, frequência, volume, lineage) devem vir automaticamente; metadados de negócio (significado, dono, criticidade) precisam de curadoria, e é aí que o processo precisa ser leve o suficiente para acontecer.

**Ownership** é o conceito mais subestimado de governança. Todo dataset precisa de um dono nomeado — uma pessoa ou um time, não "a área de dados". Sem dono: ninguém corrige, ninguém decide sobre mudanças, ninguém responde quando quebra, e ninguém autoriza a exclusão. A entropia sempre vence quando a responsabilidade é difusa.

**Controle de acesso** costuma operar em três granularidades: tabela, coluna (mascarar CPF para quem não precisa) e linha (cada gerente vê só sua região). O modelo mais gerenciável é baseado em papéis ou atributos, definido no catálogo e aplicado pelo engine — não implementado em views ad hoc espalhadas, que ninguém consegue auditar.

**MDM (Master Data Management)** vale conhecer: a disciplina de manter uma versão única e confiável das entidades centrais (cliente, produto, fornecedor) entre sistemas. É onde vivem os problemas de resolução de entidade — o mesmo cliente cadastrado três vezes com grafias diferentes.

### 1.8 LGPD e GDPR: o que um engenheiro de dados precisa saber

Não é preciso ser advogado, mas é preciso conhecer os conceitos que **restringem decisões de arquitetura**.

**Conceitos:**
- **Dado pessoal**: qualquer informação relacionada a pessoa natural identificada ou identificável. Inclui identificadores indiretos — IP, cookie, ID de dispositivo, e combinações que permitem reidentificação.
- **Dado pessoal sensível** (LGPD) / **categorias especiais** (GDPR): origem racial ou étnica, convicção religiosa, opinião política, filiação sindical, dado referente a saúde, vida sexual, dado genético e biométrico. Proteção reforçada e bases legais mais restritas.
- **Titular**: a pessoa a quem o dado se refere.
- **Controlador**: quem decide as finalidades e os meios do tratamento.
- **Operador** (LGPD) / **processador** (GDPR): quem trata em nome do controlador.
- **Encarregado / DPO**: canal de comunicação com titulares e autoridade.

**Princípios que viram requisito técnico:**
- **Finalidade e necessidade (minimização)**: colete e retenha só o necessário para a finalidade declarada. Isso confronta diretamente a cultura de "guarda tudo que talvez sirva" do data lake — e é um ótimo ponto para levantar numa entrevista de arquitetura.
- **Base legal**: todo tratamento precisa de uma. Consentimento é apenas uma delas; legítimo interesse, execução de contrato e obrigação legal são outras. Se a base é consentimento, ele precisa ser rastreável e revogável — o que significa que o pipeline precisa saber *quem consentiu com o quê* e propagar revogações.
- **Direitos do titular**: acesso, correção, portabilidade, eliminação, informação sobre compartilhamento, e revisão de decisões automatizadas. Cada um vira um requisito técnico concreto.
- **Retenção limitada**: dado não pode ser mantido indefinidamente sem justificativa.
- **Segurança e privacy by design**: proteção considerada desde a arquitetura, não adicionada depois.

**Os problemas técnicos concretos que isso gera** — e é aqui que a pergunta de entrevista mora:

**Direito à eliminação em storage imutável.** Parquet é imutável; um log de eventos é append-only; backups são imutáveis por definição. Como apagar uma pessoa? Abordagens: formatos de tabela com DELETE (que reescrevem ou usam deletion vectors), tombstones em log compactado no Kafka, e **crypto-shredding** — cifrar os dados de cada titular com uma chave própria e destruir a chave, tornando o dado irrecuperável sem reescrever nada. Crypto-shredding é a resposta elegante para backups e logs imutáveis, e citá-la impressiona.

**Propagação da exclusão.** Apagar da tabela principal não basta se o dado foi copiado para dez tabelas derivadas, um cache, um índice de busca e um sistema de terceiros. É exatamente por isso que lineage deixa de ser conveniência e vira requisito de compliance.

**Anonimização vs pseudonimização.** Distinção crucial e frequentemente cobrada:
- **Pseudonimização** substitui identificadores por tokens, mas mantém a possibilidade de reidentificação com informação adicional (a tabela de mapeamento). Dado pseudonimizado **continua sendo dado pessoal** e continua sujeito à lei.
- **Anonimização** torna a reidentificação impossível por meios razoáveis. Dado verdadeiramente anônimo sai do escopo da lei.
- **O ponto que separa candidatos:** anonimização real é muito mais difícil do que parece. Remover o nome e o CPF não anonimiza nada — combinações de atributos (CEP, data de nascimento, sexo) reidentificam a maior parte das pessoas. Por isso existem k-anonimato (cada registro é indistinguível de pelo menos k-1 outros), l-diversidade e privacidade diferencial (adicionar ruído calibrado com garantia matemática). Muita coisa chamada de "anonimizada" na prática é apenas pseudonimizada, e essa confusão gera exposição regulatória real.

**Transferência internacional.** Ambas as leis restringem envio de dados para outros países sem salvaguardas. Isso afeta escolha de região de nuvem e de fornecedores.

**Ambientes de desenvolvimento.** Copiar a base de produção para dev é uma das violações mais comuns e menos discutidas. A solução é dado sintético ou mascarado — e mascarar preservando integridade referencial e distribuição estatística é um problema técnico não trivial.

**Diferenças entre LGPD e GDPR** que valem mencionar: são muito similares em estrutura e princípios; a LGPD tem dez bases legais (contra seis do GDPR), sanções com teto de 2% do faturamento no Brasil limitado a R$ 50 milhões por infração (contra até 4% do faturamento global no GDPR), e a autoridade brasileira é a ANPD. Para engenharia, as implicações práticas são essencialmente as mesmas.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Quais são as dimensões de qualidade de dados?**

*Resposta modelo:* Completude (o que deveria estar lá está?), acurácia (reflete a realidade?), consistência (concorda entre si e entre sistemas?), unicidade (há duplicatas?), validade (respeita formato, tipo e domínio?), atualidade (chegou quando deveria?) e integridade referencial (as chaves apontam para registros existentes).

Eu acrescentaria uma que costuma ficar de fora e é a mais perigosa: a **semântica** — o campo significa o que as pessoas acham que significa. Nenhum teste automático pega isso, porque o schema é válido e os valores são plausíveis; o número está errado porque dois times definem "receita" de formas diferentes.

---

**🟢 P2. Que tipos de teste de qualidade você implementaria num pipeline?**

*Resposta modelo:* Unicidade da chave primária, not null em campos obrigatórios, valores dentro do conjunto ou da faixa permitida, integridade referencial contra as dimensões, volume de linhas dentro do esperado — comparando com o mesmo dia da semana anterior, porque sazonalidade semanal é forte — e reconciliação contra a origem em métricas-chave.

Adicionaria testes de distribuição: se a proporção de cada categoria mudou bruscamente, algo mudou na origem, e isso não é detectado por teste de schema.

E o mais importante é **onde** eles rodam: uso write-audit-publish — escrevo num local temporário, valido, e publico atomicamente só se passar. Publicar e auditar depois significa que, quando o alerta chega, alguém já usou o número.

---

**🟢 P3. O que é lineage e para que serve?**

*Resposta modelo:* É o mapa de origem e transformação: de onde o dado veio, por onde passou e o que depende dele.

Serve para quatro coisas na prática: análise de impacto antes de mudar algo, análise de causa raiz quando um número está errado, compliance — localizar todas as cópias derivadas de dados pessoais para atender um pedido de exclusão — e priorização, distinguindo a tabela que alimenta o relatório do conselho da que é experimento abandonado.

Column-level lineage é bem mais útil que table-level, e bem mais difícil de manter.

---

**🟢 P4. O que é dado pessoal segundo a LGPD?**

*Resposta modelo:* Qualquer informação relacionada a pessoa natural identificada ou **identificável**. O ponto que costuma ser subestimado é o "identificável": inclui identificadores indiretos como IP, cookie e ID de dispositivo, e inclui combinações de atributos que permitem reidentificação mesmo sem nome ou CPF.

Há ainda a categoria de dado pessoal sensível — origem racial, convicção religiosa, opinião política, filiação sindical, saúde, vida sexual, genético e biométrico — com proteção reforçada e bases legais mais restritas.

---

### 🟡 Intermediário

**🟡 P5. O que é um contrato de dados e o que ele deve conter?**

*Resposta modelo:* É um acordo explícito e versionado entre produtor e consumidor de um dataset. Deve conter schema com tipos e obrigatoriedade, a **semântica** de cada campo em linguagem clara, garantias de qualidade, SLA de frequência e latência, política de evolução — o que pode mudar, com quanto aviso e sob qual modo de compatibilidade —, ownership e classificação de sensibilidade.

O problema que resolve é que, sem contrato, o time de dados constrói pipelines sobre tabelas internas de aplicações que nunca prometeram estabilidade. Um desenvolvedor renomeia uma coluna numa refatoração legítima e quebra dez dashboards sem saber que existiam.

E o que faz funcionar é ser **verificado automaticamente**: validação em CI do lado do produtor, validação na ingestão do lado do consumidor, e Schema Registry com modo de compatibilidade em mensageria. Contrato que é só documento não muda nada.

A parte difícil, aliás, não é técnica: é fazer o time de aplicação assumir responsabilidade por consumidores analíticos. Isso exige acordo organizacional, não ferramenta.

---

**🟡 P6. Qual a diferença entre testes de qualidade e observabilidade de dados?**

*Resposta modelo:* Teste verifica uma regra que você **sabia** escrever: chave única, valor não negativo, FK válida. Observabilidade monitora o comportamento do dado ao longo do tempo e detecta o que você **não previu** — freshness, volume, mudança de schema, desvio de distribuição, e lineage para avaliar impacto.

Na prática: um teste falha quando você antecipou o problema. Observabilidade dispara quando a taxa de nulos numa coluna salta de 0,1% para 12% sem que ninguém tivesse escrito um teste para aquela coluna.

São complementares, e a cobertura real vem da combinação. O risco da observabilidade automatizada é gerar alerta demais — detecção de anomalia sobre centenas de colunas produz ruído que ninguém lê, então precisa ser calibrada e priorizada pela criticidade das tabelas.

---

**🟡 P7. Como você lida com o "direito ao esquecimento" numa arquitetura de data lake?**

*Resposta modelo:* O problema é que a arquitetura é feita de coisas imutáveis: Parquet não se altera, logs são append-only, backups são imutáveis por definição.

Três abordagens, e normalmente uso mais de uma.

**Formato de tabela com DELETE.** Iceberg ou Delta suportam remoção de linha, seja reescrevendo os arquivos afetados, seja com deletion vectors. Resolve a camada analítica.

**Tombstones em log compactado.** No Kafka, publicar uma mensagem nula para a chave do titular num tópico compactado remove o valor na compactação. É o mecanismo padrão ali.

**Crypto-shredding.** Cifrar os dados de cada titular com uma chave individual e destruir a chave quando a exclusão é solicitada. O dado permanece fisicamente mas se torna irrecuperável. É a resposta elegante para backups e logs históricos que não podem ser reescritos.

Mas o desafio maior não é apagar da tabela principal — é **propagar**. O dado foi copiado para tabelas derivadas, agregados, caches, índices de busca e possivelmente sistemas de terceiros. É exatamente por isso que lineage deixa de ser conveniência e vira requisito de compliance: sem ele, você não consegue nem afirmar que cumpriu.

Na prática, eu desenharia para isso desde o começo: isolar PII em poucas tabelas com referência por identificador substituto nas demais, de modo que apagar de um lugar propague por construção em vez de exigir caçada.

---

**🟡 P8. Qual a diferença entre anonimização e pseudonimização?**

*Resposta modelo:* Pseudonimização substitui identificadores por tokens, mas mantém a possibilidade de reidentificação com informação adicional — tipicamente uma tabela de mapeamento guardada separadamente. Dado pseudonimizado **continua sendo dado pessoal** e continua sujeito à lei; a pseudonimização é uma medida de segurança, não uma saída do escopo regulatório.

Anonimização torna a reidentificação impossível por meios razoáveis, e aí o dado sai do escopo.

O ponto crítico é que anonimização real é muito mais difícil do que parece. Remover nome e CPF não anonimiza: combinações de CEP, data de nascimento e sexo reidentificam a maior parte das pessoas. Por isso existem técnicas formais — k-anonimato, onde cada registro é indistinguível de pelo menos k-1 outros; l-diversidade; e privacidade diferencial, que adiciona ruído calibrado com garantia matemática.

Na prática, muita coisa chamada de "anonimizada" é apenas pseudonimizada, e essa confusão gera exposição regulatória real. Eu seria explícito sobre qual das duas estou entregando.

---

**🟡 P9. Como você garantiria qualidade sem bloquear a entrega do time?**

*Resposta modelo:* Classificando severidade, porque tratar tudo como bloqueante é o caminho mais rápido para as pessoas desligarem os testes.

**Bloqueante** para quebra de invariante estrutural: chave duplicada, FK órfã, volume 90% abaixo do esperado. Publicar isso é pior que atrasar.

**Alerta** para desvio estatístico que merece investigação mas não invalida o dado.

**Informativo** para métricas monitoradas ao longo do tempo.

Além disso, faria três coisas. Começar pelas tabelas críticas em vez de tentar cobrir tudo — cobertura uniforme é cara e dilui a atenção. Automatizar os testes óbvios na criação da tabela (unicidade da PK, not null nos obrigatórios) para que a linha de base seja gratuita. E medir o ruído: se um alerta dispara toda semana e ninguém age, ele está errado e precisa ser recalibrado ou removido, porque alerta ignorado é pior que alerta ausente — ele treina o time a ignorar.

---

### 🔴 Avançado

**🔴 P10. Como você implementaria governança de dados numa empresa que não tem nenhuma?**

*Resposta modelo:* Não começaria por ferramenta nem por política escrita. Começaria por um problema concreto que doa, porque governança sem dor percebida vira burocracia rejeitada.

**Primeiro, inventário e criticidade.** Descobrir o que existe, quem usa (logs de acesso são a melhor fonte, muito melhor que perguntar), e quais são os poucos datasets que sustentam decisões importantes. Governança começa por eles, não por tudo.

**Segundo, ownership.** Cada dataset crítico ganha um dono nomeado. É a intervenção de maior retorno e a mais barata: sem dono, ninguém corrige nada e a entropia vence. E "o time de dados" não é dono útil.

**Terceiro, classificação de sensibilidade.** Marcar o que é PII e o que é sensível, porque isso determina controle de acesso e é a parte com risco regulatório.

**Quarto, catálogo alimentado automaticamente.** Schema, frequência, volume, lineage e quem consulta devem vir de metadados automáticos. Só o significado de negócio precisa de curadoria humana — e esse processo tem que ser leve, porque catálogo que depende de documentação manual fica desatualizado em três meses e para de ser consultado.

**Quinto, testes de qualidade nas tabelas críticas** com write-audit-publish, e SLA declarado.

**Sexto, controle de acesso por papel**, definido centralmente e aplicado pelo engine, em vez de views ad hoc que ninguém consegue auditar.

E o que realmente decide o resultado: **um fórum de decisão e incentivos**. Governança falha quando é imposta por um time sem autoridade sobre quem produz os dados. Precisa de patrocínio, de participação dos donos de domínio, e de consequência quando o contrato é quebrado. Eu apresentaria isso explicitamente como condição, porque prometer governança sem isso é prometer o que não se pode entregar.

---

**🔴 P11. Um número no dashboard executivo está errado. Como você conduz?**

*Resposta modelo:* Antes de investigar, uma pergunta: **está errado ou está diferente do que a pessoa esperava?** Uma fração grande desses casos é divergência de definição, não bug. "Receita" líquida ou bruta? Inclui cancelamentos? Qual fuso horário define o dia? Descobrir isso primeiro economiza horas.

Se for bug de verdade:

**Contenção primeiro.** Sinalizar o dashboard como sob investigação, para que ninguém tome mais decisões com ele. Isso vem antes do diagnóstico — o custo de decisões erradas continua correndo enquanto você investiga.

**Delimitar.** Quando começou? Afeta todas as métricas ou uma? Todos os períodos ou só recentes? Isso já aponta para a camada provável: se só o período recente está errado, é uma mudança na origem ou no pipeline; se o histórico inteiro mudou, alguém reprocessou com lógica nova.

**Seguir o lineage de trás para frente**, comparando em cada camada com a anterior, até achar onde a divergência aparece. Sem lineage, isso é arqueologia; com ele, são minutos.

**Verificar as suspeitas usuais:** duplicação por join com chave não única — a causa mais comum, porque infla números de forma plausível; mudança de schema ou de semântica na origem; carga parcial que foi publicada; alteração de lógica que não foi comunicada; e fuso horário na fronteira do dia.

**Corrigir e reprocessar** com write-audit-publish, validando contra a origem antes de publicar.

**Depois, o mais importante:** um post-mortem sem culpados que responda por que o teste automático não pegou. Toda ocorrência dessas deveria virar um teste novo. Se o mesmo tipo de problema acontece duas vezes, o processo falhou, não a pessoa. E comunicar proativamente aos consumidores o que houve e o que foi corrigido — silêncio destrói mais confiança que o erro em si.

---

**🔴 P12. Como você desenharia uma plataforma de dados para atender LGPD desde o início?**

*Resposta modelo:* Privacy by design significa que as restrições entram na arquitetura, não como camada adicionada depois.

**Minimização na ingestão.** Não coletar o que não tem finalidade declarada. Isso confronta diretamente a cultura de "guarda tudo que talvez sirva" do data lake, e é uma conversa que precisa ser explícita — porque tecnicamente é mais fácil guardar tudo, e juridicamente é o oposto.

**Isolamento de PII.** Concentrar dados pessoais em poucas tabelas, com as demais referenciando por identificador substituto. Isso torna acesso, mascaramento e exclusão tratáveis: você controla um perímetro pequeno em vez de caçar PII espalhada por trezentas tabelas.

**Classificação automática e obrigatória.** Toda coluna tem classificação de sensibilidade como metadado, e as políticas de acesso e mascaramento são derivadas dela pelo engine, não implementadas manualmente por tabela. Colunas não classificadas devem ser tratadas como restritas por padrão.

**Mascaramento dinâmico por papel.** O mesmo dado exibe CPF completo para quem tem base legal e mascarado para os demais, sem manter duas cópias.

**Crypto-shredding por titular** em camadas históricas e backups, para que a exclusão seja viável sem reescrever dados imutáveis.

**Rastreamento de consentimento e base legal como dado de primeira classe**, propagado pelo pipeline. Se a base é consentimento, o pipeline precisa saber quem consentiu com o quê e reagir a revogações — não adianta a política existir se o dado não carrega essa informação.

**Retenção automatizada.** Política por dataset, aplicada por processo, não por lembrete. Retenção manual não acontece.

**Lineage como requisito**, porque sem ele você não consegue provar que uma exclusão se propagou.

**Ambientes de desenvolvimento com dado sintético ou mascarado.** Copiar produção para dev é uma das violações mais comuns e menos discutidas, e mascarar preservando integridade referencial e distribuição é um problema técnico que precisa ser resolvido de verdade, não improvisado.

**Trilha de auditoria** de quem acessou o quê, que é exigível e frequentemente esquecida.

E eu envolveria o DPO ou o jurídico nas decisões de arquitetura desde o começo, porque várias dessas escolhas dependem de interpretação legal — base legal aplicável, prazo de retenção, o que conta como anonimizado — e engenheiro decidindo isso sozinho é como esses problemas surgem.

---

**🔴 P13. Como você mediria se a qualidade de dados está melhorando?**

*Resposta modelo:* Com métricas de resultado, não de atividade. "Número de testes escritos" é métrica de atividade e não diz nada sobre confiabilidade.

**Tempo de detecção.** Quanto tempo entre o problema ocorrer e ser detectado. É a métrica mais importante, porque tudo depende dela: se cai de dias para minutos, o dano cai junto.

**Origem da detecção.** Que fração dos incidentes foi encontrada pelo monitoramento versus reportada por um usuário. Descobrir pelo usuário é o pior caso, e a proporção entre os dois é um indicador direto de maturidade.

**Tempo de resolução**, e quanto dele é diagnóstico — porque diagnóstico longo aponta falta de lineage e de observabilidade, que é acionável.

**Incidentes recorrentes.** O mesmo tipo de problema repetindo indica que a correção tratou sintoma. Idealmente, cada incidente vira um teste, e a recorrência tende a zero.

**Cumprimento de SLA de freshness** nas tabelas críticas.

**Cobertura ponderada por criticidade**, não cobertura bruta — 100% de testes em tabelas irrelevantes não vale nada.

E duas métricas de confiança, que são o objetivo real: a **taxa de ruído dos alertas** (fração de alertas que não geraram ação — se for alta, o sistema está treinando as pessoas a ignorar) e alguma medida de confiança do consumidor, seja uma pesquisa simples, seja o indicador indireto de quantos times mantêm planilhas paralelas em vez de usar a plataforma.

---

**🔴 P14. Um time de aplicação mudou o schema e quebrou seu pipeline. Como você evita que isso se repita?**

*Resposta modelo:* Trataria como falha de processo, não do desenvolvedor — do ponto de vista dele, ele fez uma refatoração legítima numa tabela interna do serviço dele, e ninguém disse que havia dez dashboards dependendo dela. A dependência era invisível.

**Curto prazo: falhar cedo e alto.** Validação de schema na ingestão, que interrompe o pipeline com erro claro em vez de propagar silenciosamente. Um schema mudado que só aparece dez camadas adiante como número errado é muito pior que uma falha na porta de entrada.

**Médio prazo: tornar a dependência visível e contratual.** Um contrato de dados sobre aquela interface, verificado no CI do produtor — se a mudança quebra o contrato, o build dele falha, e ele descobre em minutos em vez de eu descobrir em produção. Esse é o único mecanismo que realmente funciona, porque coloca o sinal onde a decisão é tomada.

**Estrutural: parar de ler tabelas internas de aplicação.** A causa raiz é acoplamento a um detalhe de implementação de outro sistema. A alternativa é o produtor publicar uma interface estável e versionada — eventos com schema registrado, ou uma tabela/view explicitamente pública — e o pipeline consumir isso. Aí ele pode refatorar internamente à vontade.

**Organizacional, e é a parte que decide:** o time de aplicação precisa aceitar que consumidores analíticos existem e importam. Isso exige patrocínio e priorização; sem isso, o contrato é um documento que ninguém cumpre. Eu levaria a conversa nesse nível, com o custo do incidente quantificado, em vez de tratar como problema técnico isolado.

E, no imediato, um canal de comunicação simples: eles saberem quem avisar quando mudarem algo, e eu ter visibilidade das mudanças planejadas.

---

**🔴 P15. Qual a diferença entre governança centralizada e federada? Qual você recomenda?**

*Resposta modelo:* Centralizada significa um time definindo padrões, aprovando mudanças e frequentemente executando o trabalho de dados. Vantagens: consistência, definições únicas, controle de acesso coerente, e uma visão global. Desvantagem: o time vira gargalo e não tem contexto de negócio suficiente sobre dezenas de domínios — as decisões ficam lentas e às vezes erradas por falta de contexto.

Federada distribui a responsabilidade para os domínios, com padrões globais definidos centralmente. Vantagem: quem conhece o dado cuida dele, e escala com a organização. Desvantagem: sem mecanismos fortes de padronização, cada domínio diverge e você recria silos com definições incompatíveis.

O modelo que eu recomendo é **governança federada computacional**, que é o quarto princípio do Data Mesh e o que torna o resto viável: os padrões globais são **aplicados automaticamente pela plataforma** em vez de dependerem de disciplina. Classificação de sensibilidade obrigatória para publicar, contrato validado em CI, política de acesso derivada de metadado, testes mínimos como condição de publicação. Assim o domínio tem autonomia dentro de trilhos que ele não consegue sair sem esforço deliberado.

E ajustaria pela maturidade e pelo tamanho: numa empresa pequena, centralizado funciona melhor e a sobrecarga de coordenação do federado não se paga. Em organizações grandes com domínios genuinamente independentes, federado é a única coisa que escala. O erro comum é adotar federação sem a parte computacional — aí você tem descentralização sem contrapesos, que é o silo de sempre com nome novo.

---

## 3. Armadilhas comuns

**Tratar qualidade como responsabilidade do consumidor.** Se o erro é descoberto quando alguém questiona um número, já é tarde: ele circulou, embasou decisões e consumiu confiança.

**Publicar e auditar depois.** Write-audit-publish existe justamente para que o dado ruim nunca fique visível.

**Fazer todo teste bloquear.** As pessoas desligam os testes para o pipeline rodar, e você fica pior do que antes. Classifique severidade.

**Alerta que ninguém lê.** Alerta ignorado é pior que alerta ausente, porque treina o time a ignorar tudo. Meça a taxa de ruído e recalibre.

**Confundir pseudonimização com anonimização.** Dado pseudonimizado continua sendo dado pessoal e continua sujeito à lei. Remover nome e CPF não anonimiza.

**Achar que apagar da tabela principal cumpre o direito à eliminação.** Sem propagar para derivadas, caches, índices e terceiros, você não cumpriu — e sem lineage, não consegue nem afirmar que cumpriu.

**Copiar produção para desenvolvimento.** É uma das violações mais comuns e menos discutidas.

**Catálogo alimentado manualmente.** Fica desatualizado em três meses, para de ser consultado, e o abandono se retroalimenta. Metadados técnicos precisam ser automáticos.

**Dataset sem dono nomeado.** "A área de dados" não é dono. Sem responsável, ninguém corrige, ninguém decide e ninguém autoriza a exclusão.

**Contrato de dados como documento.** Se não é validado automaticamente no CI do produtor, é decoração.

**Apresentar lineage automático como completo.** Ele perde o que acontece dentro de UDFs e de código customizado. Em compliance, essa lacuna importa.

**Medir qualidade por número de testes escritos.** Métrica de atividade. O que importa é tempo de detecção e quem detectou.

**Culpar o desenvolvedor que quebrou o schema.** A dependência era invisível para ele. O problema é de processo, e a correção é contrato validado onde ele toma a decisão.

**Tratar governança como problema de ferramenta.** Sem ownership, patrocínio e consequência, nenhuma ferramenta resolve.
