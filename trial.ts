import {embedText} from './src/config/openRouterAI.js';

console.log(await embedText(`Research question: Should police departments use predictive patrol systems when the systems are
independently audited for accuracy, bias, and feedback effects? Working argument: Conditional use
may be defensible only if independent, ongoing audits show meaningful public-safety benefits and
manageable inequities; if feedback loops or harms cannot be controlled, departments should not
use the systems.
I. Introduction: Why predictive patrols are contested
A. Define place-based forecasting and the translation of crime data into patrol
deployment (Perry et al., 2013).
B. Introduce the dispute: better allocation of limited resources versus the danger of
unequal surveillance (Meijer & Wessels, 2019; Ferguson, 2017).
II. How forecasts and feedback loops operate
A. Explain historical crime records, location predictions, and police response;
distinguish forecast accuracy from operational success (Bennett Moses & Chan,
2018).
B. Show how repeated patrols generate recorded incidents that may reinforce future
deployment (Ensign et al., 2018; Lum & Isaac, 2016).
C. Examine how historical enforcement practices and surveillance patterns can bias
input data even without explicit racial variables (Brayne, 2017; Richardson et al.,
2019).
III. The evidence for and against predictive patrols
A. Consider potential forecast and crime-prevention gains in Los Angeles trials
(Mohler et al., 2015).
B. Contrast Shreveport’s statistically inconclusive results with intervention-specific
Philadelphia findings (Hunt et al., 2014; Ratcliffe et al., 2021).
C. Assess limitations of external validity, deployment records, and the distinction
between prediction and prevention (Meijer & Wessels, 2019; Office of the
Inspector General, Los Angeles Police Commission, 2019).
IV. Could independent audits make use responsible?
A. Test data provenance, error rates, disparate impacts, feedback effects, and actual
officer practice—not just code (Bennett Moses & Chan, 2018; Selbst et al., 2019).`));
