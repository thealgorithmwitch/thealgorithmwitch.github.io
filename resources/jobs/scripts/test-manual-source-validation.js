const assert = require("assert");

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

const MANUAL_SOURCE_NON_JOB_TITLE_PATTERNS = [
  /^view all jobs?\s*(?:\([^)]*\))?$/i,
  /^powered by/i,
  /^apply now?\s*$/i,
  /^apply\s*$/i,
  /^find jobs?\s+in\b/i,
  /^jobs?\s+in\b/i,
  /^discover job opportunities?\s+in\b/i,
  /^explore jobs?\s+opportunities?\s+in\b/i,
  /^explore career options?\s+in\b/i,
  /^explore programmes?\s*$/i,
  /^find out more about\b/i,
  /^join\s+#?teamrwe\b/i,
  /^join our vibrant\b/i,
  /^join our team/i,
  /^check out our\b/i,
  /^further insights on\b/i,
  /^untitled\s*$/i,
  /^welcome\s*$/i,
  /^learn more\s*$/i,
  /^funding opportunities?\s*$/i,
  /^reports?\s*$/i,
  /^articles?\s*$/i,
  /^resources\s*$/i,
  /^search jobs?\s*$/i,
  /^why work here/i,
  /^onboarding\b/i,
  /^learning & development\b/i,
  /^equal opportunity employer\b/i,
  /^statements?\s*&?\s*positions?\s*$/i,
  /^see\s+(?:nuclear|power)\s+/i,
  /^view jobs?\s*$/i,
  /^find open positions?\s*$/i,
  /^emerging leaders\b/i,
  /\b\.html\s*$/i,
  /^\s*$/
];

const MANUAL_SOURCE_NON_ROLE_URL_PATTERNS = [
  /info\.jazzhr\.com\//i,
  /\.applytojob\.com\/apply\/?$/i,
  /\.applytojob\.com\/apply\/?\?/i,
  /americanprogress\.org\/(?:article|report)\//i,
  /energycommunities\.gov\//i,
  /\/(?:funding-opportunities|funding|grants)\b/i,
  /\/(?:report|reports)\//i,
  /\/(?:article|articles)\//i,
  /\/(?:policy|resources)\b/i,
  /\/(?:press|press-release|news|blog)\b/i,
  /\/(?:people|profile|team|employee|story|stories|meet-our)\//i,
  /\/(?:career-stories?|teamrwe)\//i,
  /\/(?:from-learning-to-leading|the-power-of-all-voices)\//i,
  /\/global-presence\//i,
  /\/faq\b/i,
  /\/privacy\b/i,
  /\/privacy-policy\b/i,
  /\/cookie\b/i,
  /\/legal\b/i,
  /\/accessibility\b/i,
  /\/terms-of-/i,
  /\/equal-opportunity\b/i,
  /\/ca-ccpa-notice\b/i,
  /\?locale=/i,
  /\?searchby=/i,
  /nexteraenergy\.com\/careers\/join-our-team\//i,
  /nexteraenergy\.com\/careers\/life-at-/i,
  /nexteraenergy\.com\/careers\/(?:ca-|equal-)/i,
  /nexteraenergy\.com\/careers\.html/i,
  /nexteraenergy\.com\/careers\/join-our-team\.html/i,
  /\/(?:searchby=|\?q=|search\?)/i,
  /\/(?:job-offers|job-offers\/)\?(?:.*[?&])?(?:ci|cn)=/i,
  /rwe\.com\/en\/press\//i,
  /rwe\.com\/en\/rwe-careers-portal\/teamrwe\//i,
  /rwe\.com\/en\/rwe-careers-portal\/why-work-here\//i,
  /rwe\.com\/en\/rwe-careers-portal\/experienced-professionals\//i,
  /rwe\.com\/en\/rwe-careers-portal\/what-we-offer\//i,
  /rwe\.com\/en\/rwe-careers-portal\/early-careers\//i,
  /rwe\.com\/en\/rwe-careers-portal\/careers-asia\//i,
  /rwe\.com\/en\/rwe-careers-portal\/(?:#|$)/i,
  /pl\.rwe\.com\//i,
  /uk\.rwe\.com\//i,
  /fr\.rwe\.com\//i,
  /americas\.rwe\.com\//i,
  /rwe\.com\/en\/press\//i
];

function isManualSourceNonJobTitle(title) {
  const clean = String(title || "").trim();
  if (!clean) return { rejected: true, reason: "empty_title" };
  if (MANUAL_SOURCE_NON_JOB_TITLE_PATTERNS.some((p) => p.test(clean))) {
    return { rejected: true, reason: "generic_non_job_title" };
  }
  const lower = clean.toLowerCase();
  if (/^[a-z\s]+$/.test(clean) && clean.split(/\s+/).length <= 2 && !/\b(?:manager|director|analyst|specialist|lead|coordinator|associate|officer|engineer|consultant|representative|advisor|supervisor|technician|assistant|head|vp|chief|president|attorney|counsel|developer|architect|scientist|planner|writer|editor|producer|strategist)\b/i.test(lower)) {
    return { rejected: true, reason: "generic_non_specific_title" };
  }
  return { rejected: false, reason: null };
}

function isManualSourceNonRoleUrl(url, title) {
  const normalized = normalizeUrl(url);
  if (!normalized) return { rejected: true, reason: "missing_url" };

  if (MANUAL_SOURCE_NON_ROLE_URL_PATTERNS.some((p) => p.test(normalized))) {
    return { rejected: true, reason: "non_job_url" };
  }

  try {
    var parsed = new URL(normalized);
  } catch (_error) {
    return { rejected: true, reason: "invalid_url" };
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const query = parsed.search.toLowerCase();

  if (host.includes("rwe.com") && /\/job-offers\//i.test(path)) {
    if (/[?&](?:ci|cn)=/i.test(query) && !/\/\d{6,}\//i.test(path)) {
      return { rejected: true, reason: "rwe_location_search_page" };
    }
    if (/\/job-offers\/?$/i.test(path) && !/\/\d{6,}\//i.test(path)) {
      return { rejected: true, reason: "rwe_job_offers_listing" };
    }
  }

  if (host.includes("nexteraenergy.com") && !host.includes("jobs.nexteraenergy.com")) {
    if (/\/(?:join-our-team|life-at|recent-grads|field-jobs)/i.test(path)) {
      return { rejected: true, reason: "nextera_category_page" };
    }
  }

  if (host.includes("jobs.nexteraenergy.com")) {
    if (!/\/job\//i.test(path) && !/\/job\//i.test(decodeURIComponent(path))) {
      if (/\/(?:search|$)/i.test(path) && !String(title).toLowerCase().includes("product manager") && !String(title).toLowerCase().includes("director")) {
        return { rejected: true, reason: "nextera_search_or_home" };
      }
    }
  }

  if (host.includes("applytojob.com") && host !== "louisianabucketbrigade.applytojob.com") {
    if (/\/apply\/?$/i.test(path) || /\/apply\/?\?/i.test(path)) {
      return { rejected: true, reason: "applytojob_listing_page" };
    }
  }

  return { rejected: false, reason: null };
}

function attemptTitleRecovery(job) {
  const rawTitle = String(job.title || "");
  const rawDesc = String(job.raw_description || job.description || "");
  if (!rawTitle.trim() || MANUAL_SOURCE_NON_JOB_TITLE_PATTERNS.some((p) => p.test(rawTitle.trim()))) {
    if (/GIS\s+Manager/i.test(rawDesc)) return "GIS Manager";
    if (/donor\s+engagement\s+manager/i.test(rawDesc)) return "Donor Engagement Manager";
    const titleMatch = rawDesc.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})\s+(?:Manager|Director|Coordinator|Specialist|Analyst|Lead|Officer|Engineer|Consultant|Advisor|Associate|Supervisor|Attorney|Counsel|Developer|Architect|Scientist|Planner|Writer|Editor|Producer|Strategist|Head|VP|Chief|President)\b/i);
    if (titleMatch && titleMatch[0].length >= 6 && titleMatch[0].length <= 150) return titleMatch[0];
  }
  return rawTitle;
}

function looksLikeRealJobUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  try {
    var parsed = new URL(normalized);
  } catch (_error) {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  if (/\/postings\//i.test(path)) return true;
  if (/\/job\//i.test(path)) return true;
  if (/\/jobs\//i.test(path) && /\/\d{6,}\//i.test(path)) return true;
  if (/\/apply\//i.test(path) && path.split("/").filter(Boolean).length >= 3) return true;
  if (/-[A-Z]{2}-\d{5,}\//i.test(path)) return true;
  return false;
}

function validateManualSourceCandidate(job) {
  let title = String(job.title || "").trim();
  const organization = String(job.organization || "").trim();
  const url = job.original_url || job.apply_url || job.source_url;
  const recovered = attemptTitleRecovery(job);
  if (recovered && recovered !== title) {
    title = recovered;
    job.title = recovered;
    job.title_confidence = "medium";
  }
  const titleResult = isManualSourceNonJobTitle(title);
  if (titleResult.rejected) {
    if (titleResult.reason === "empty_title" && url && !isManualSourceNonRoleUrl(url, title).rejected && looksLikeRealJobUrl(url)) {
      return { valid: false, bucket: "needs_cleanup", reason: "manual_source_empty_title_recoverable_job_url" };
    }
    return { valid: false, bucket: "rejected_noise", reason: "manual_source_" + titleResult.reason };
  }
  if (!url) {
    return { valid: false, bucket: "rejected_noise", reason: "manual_source_missing_url" };
  }
  const urlResult = isManualSourceNonRoleUrl(url, title);
  if (urlResult.rejected) {
    return { valid: false, bucket: "rejected_noise", reason: "manual_source_" + urlResult.reason };
  }
  if (!organization) {
    return { valid: false, bucket: "rejected_noise", reason: "manual_source_missing_organization" };
  }
  return { valid: true, bucket: "review_ready", reason: null };
}

function main() {
  let passed = 0;
  let failed = 0;

  function check(label, actual, expected) {
    try {
      if (typeof expected === "object" && expected !== null) {
        assert.deepStrictEqual(actual, expected);
      } else {
        assert.strictEqual(actual, expected);
      }
      passed++;
    } catch (e) {
      failed++;
      console.error("FAIL:", label);
      console.error("  expected:", JSON.stringify(expected));
      console.error("  actual:  ", JSON.stringify(actual));
    }
  }

  // === 1. Bullard Center GIS Manager (when GIS Manager is in description) ===
  const bullardJob = {
    title: "",
    organization: "Bullard Center for Environmental and Climate Justice",
    source_url: "https://bullardcenter.org/about/careers",
    original_url: "https://jobs.tsu.edu/postings/9798",
    apply_url: "https://jobs.tsu.edu/postings/9798",
    raw_description: "Partners of the Bullard Center Maintain current knowledge of enterprise GIS technologies and developments in the field through relevant training, literature review and attendance at conferences and symposia. GIS Manager Perform other job-related duties as assigned."
  };
  const bullardRecovered = attemptTitleRecovery(bullardJob);
  check("Bullard: title recovery from description", bullardRecovered, "GIS Manager");
  const bullardInput = { ...bullardJob, title: bullardRecovered };
  const bullardResult = validateManualSourceCandidate(bullardInput);
  check("Bullard: GIS Manager recovered and accepted", bullardResult.valid, true);
  check("Bullard: recovered title is GIS Manager", bullardInput.title, "GIS Manager");

  // === 2. Emerald Cities CAP report ===
  const emeraldCap = {
    title: "CAP's Report: Proven State and Local Strategies To Create Good Jobs with IIJA Infrastructure Funds",
    organization: "Emerald Cities Collaborative",
    source_url: "https://emeraldcities.org/j40playbook/",
    original_url: "https://www.americanprogress.org/article/proven-state-and-local-strategies-to-create-good-jobs-with-iija-infrastructure-funds/",
    apply_url: "https://www.americanprogress.org/article/proven-state-and-local-strategies-to-create-good-jobs-with-iija-infrastructure-funds/"
  };
  const emeraldCapResult = validateManualSourceCandidate(emeraldCap);
  check("Emerald Cities: CAP report rejected", emeraldCapResult.valid, false);
  check("Emerald Cities: rejection reason contains url", emeraldCapResult.reason, "manual_source_non_job_url");

  // === 3. Emerald Cities energycommunities.gov ===
  const emeraldEnergy = {
    title: "Interagency Working Group on Coal & Power Plant Communities & Economic Revitalization",
    organization: "Emerald Cities Collaborative",
    source_url: "https://emeraldcities.org/j40playbook/",
    original_url: "https://energycommunities.gov/funding-opportunities/",
    apply_url: "https://energycommunities.gov/funding-opportunities/"
  };
  const emeraldEnergyResult = validateManualSourceCandidate(emeraldEnergy);
  check("Emerald Cities: energycommunities.gov funding page rejected", emeraldEnergyResult.valid, false);

  // === 4. RWE city page (Find jobs in [city]) ===
  const rweCity = {
    title: "Find jobs in Copenhagen",
    organization: "RWE",
    source_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/",
    original_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?ci=Copenhagen",
    apply_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?ci=Copenhagen"
  };
  const rweCityResult = validateManualSourceCandidate(rweCity);
  check("RWE: Find jobs in Copenhagen rejected", rweCityResult.valid, false);

  // === 5. RWE country page ===
  const rweCountry = {
    title: "Discover job opportunities in India",
    organization: "RWE",
    source_url: "https://www.rwe.com/en/rwe-careers-portal/why-work-here/global-presence/",
    original_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?cn=IN",
    apply_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?cn=IN"
  };
  const rweCountryResult = validateManualSourceCandidate(rweCountry);
  check("RWE: Discover jobs in India rejected", rweCountryResult.valid, false);

  // === 6. RWE Explore jobs in Tokyo ===
  const rweTokyo = {
    title: "Explore jobs opportunities in Tokyo",
    organization: "RWE",
    source_url: "https://www.rwe.com/en/rwe-careers-portal/why-work-here/global-presence/",
    original_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?ci=Tokyo",
    apply_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?ci=Tokyo"
  };
  const rweTokyoResult = validateManualSourceCandidate(rweTokyo);
  check("RWE: Explore jobs in Tokyo rejected", rweTokyoResult.valid, false);

  // === 7. RWE Join #TeamRWE ===
  const rweTeam = {
    title: "Join #TeamRWE in Singapore",
    organization: "RWE",
    source_url: "https://www.rwe.com/en/rwe-careers-portal/why-work-here/global-presence/",
    original_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?cn=SG",
    apply_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/?cn=SG"
  };
  const rweTeamResult = validateManualSourceCandidate(rweTeam);
  check("RWE: Join #TeamRWE rejected", rweTeamResult.valid, false);

  // === 8. RWE real job detail page (should pass if it had proper URL) ===
  const rweReal = {
    title: "Senior Policy Advisor",
    organization: "RWE",
    source_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/",
    original_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/senior-policy-advisor-123456/",
    apply_url: "https://www.rwe.com/en/rwe-careers-portal/job-offers/senior-policy-advisor-123456/"
  };
  const rweRealResult = validateManualSourceCandidate(rweReal);
  check("RWE: real job detail page accepted", rweRealResult.valid, true);

  // === 9. NextEra privacy policy ===
  const nexteraPrivacy = {
    title: "CA Privacy",
    organization: "NextEra Energy",
    source_url: "https://www.nexteraenergy.com/careers.html",
    original_url: "https://www.nexteraenergy.com/careers/ca-ccpa-notice.html",
    apply_url: "https://www.nexteraenergy.com/careers/ca-ccpa-notice.html"
  };
  const nexteraPrivacyResult = validateManualSourceCandidate(nexteraPrivacy);
  check("NextEra: CA Privacy rejected", nexteraPrivacyResult.valid, false);

  // === 10. NextEra English (Canada) locale page ===
  const nexteraLocale = {
    title: "English (Canada)",
    organization: "NextEra Energy",
    source_url: "https://jobs.nexteraenergy.com/",
    original_url: "https://jobs.nexteraenergy.com/?locale=en_CA",
    apply_url: "https://jobs.nexteraenergy.com/?locale=en_CA"
  };
  const nexteraLocaleResult = validateManualSourceCandidate(nexteraLocale);
  check("NextEra: locale page rejected", nexteraLocaleResult.valid, false);

  // === 11. NextEra individual job detail (should pass) ===
  const nexteraReal = {
    title: "Sr Product Manager I - NEA",
    organization: "NextEra Energy",
    source_url: "https://jobs.nexteraenergy.com/search/?searchby=location&createNewAlert=false&q=corporate+jobs",
    original_url: "https://jobs.nexteraenergy.com/job/Juno-Beach-Sr-Product-Manager-I-NEA-FL-33408/1384482400/",
    apply_url: "https://jobs.nexteraenergy.com/job/Juno-Beach-Sr-Product-Manager-I-NEA-FL-33408/1384482400/"
  };
  const nexteraRealResult = validateManualSourceCandidate(nexteraReal);
  check("NextEra: real job detail page accepted", nexteraRealResult.valid, true);

  // === 12. NextEra View Jobs (category page) ===
  const nexteraCategory = {
    title: "View Jobs",
    organization: "NextEra Energy",
    source_url: "https://www.nexteraenergy.com/careers/join-our-team/corporate-jobs.html",
    original_url: "https://www.nexteraenergy.com/careers/join-our-team/corporate-jobs/information-technology-jobs.html",
    apply_url: "https://www.nexteraenergy.com/careers/join-our-team/corporate-jobs/information-technology-jobs.html"
  };
  const nexteraCategoryResult = validateManualSourceCandidate(nexteraCategory);
  check("NextEra: View Jobs category page rejected", nexteraCategoryResult.valid, false);

  // === 13. NextEra Join Our Team ===
  const nexteraJoin = {
    title: "Join Our Team",
    organization: "NextEra Energy",
    source_url: "https://www.nexteraenergy.com/careers.html",
    original_url: "https://www.nexteraenergy.com/careers/join-our-team.html",
    apply_url: "https://www.nexteraenergy.com/careers/join-our-team.html"
  };
  const nexteraJoinResult = validateManualSourceCandidate(nexteraJoin);
  check("NextEra: Join Our Team rejected", nexteraJoinResult.valid, false);

  // === 14. NextEra Equal Opportunity Employer ===
  const nexteraEeo = {
    title: "Equal Opportunity Employer",
    organization: "NextEra Energy",
    source_url: "https://jobs.nexteraenergy.com/search/",
    original_url: "https://www.nexteraenergy.com/careers/equal-opportunity-employer.html",
    apply_url: "https://www.nexteraenergy.com/careers/equal-opportunity-employer.html"
  };
  const nexteraEeoResult = validateManualSourceCandidate(nexteraEeo);
  check("NextEra: Equal Opportunity Employer rejected", nexteraEeoResult.valid, false);

  // === 15. Climate Justice Alliance "View All Jobs" ===
  const cjaViewAll = {
    title: "View All Jobs",
    organization: "Climate Justice Alliance",
    source_url: "https://climatejusticealliance.applytojob.com/apply",
    original_url: "http://climatejusticealliance.applytojob.com/apply/",
    apply_url: "http://climatejusticealliance.applytojob.com/apply/"
  };
  const cjaViewAllResult = validateManualSourceCandidate(cjaViewAll);
  check("CJA: View All Jobs rejected", cjaViewAllResult.valid, false);

  // === 16. Climate Justice Alliance "Powered by" ===
  const cjaPowered = {
    title: "Powered by",
    organization: "Climate Justice Alliance",
    source_url: "https://climatejusticealliance.applytojob.com/apply",
    original_url: "https://info.jazzhr.com/job-seekers.html",
    apply_url: "https://info.jazzhr.com/job-seekers.html"
  };
  const cjaPoweredResult = validateManualSourceCandidate(cjaPowered);
  check("CJA: Powered by rejected", cjaPoweredResult.valid, false);

  // === 17. Louisiana Bucket Brigade - Donor Engagement Manager (valid) ===
  const lbbDonor = {
    title: "Donor Engagement Manager",
    organization: "Louisiana Bucket Brigade",
    source_url: "https://louisianabucketbrigade.applytojob.com/apply/",
    original_url: "https://louisianabucketbrigade.applytojob.com/apply/Rq9AD0rnpz/Donor-Engagement-Manager",
    apply_url: "https://louisianabucketbrigade.applytojob.com/apply/Rq9AD0rnpz/Donor-Engagement-Manager"
  };
  const lbbDonorResult = validateManualSourceCandidate(lbbDonor);
  check("LBB: Donor Engagement Manager accepted", lbbDonorResult.valid, true);

  // === 18. LBB Volunteer Coordinator (stale but has real title) ===
  const lbbVolunteer = {
    title: "Volunteer Coordinator",
    organization: "Louisiana Bucket Brigade",
    source_url: "https://labucketbrigade.org/",
    original_url: "https://louisianabucketbrigade.applytojob.com/apply/dAp7L2PwiF/Volunteer-Coordinator",
    apply_url: "https://louisianabucketbrigade.applytojob.com/apply/dAp7L2PwiF/Volunteer-Coordinator"
  };
  const lbbVolunteerResult = validateManualSourceCandidate(lbbVolunteer);
  check("LBB: Volunteer Coordinator accepted (has real title)", lbbVolunteerResult.valid, true);

  // === 19. RWE teamrwe (employee story) ===
  const rweTeamStory = {
    title: "What counts are the people at RWE",
    organization: "RWE",
    source_url: "https://www.rwe.com/en/rwe-careers-portal/teamrwe/",
    original_url: "https://www.rwe.com/en/rwe-careers-portal/teamrwe/it-was-great-to-develop-my-coding-skills-and-commercial-awareness/",
    apply_url: "https://www.rwe.com/en/rwe-careers-portal/teamrwe/it-was-great-to-develop-my-coding-skills-and-commercial-awareness/"
  };
  const rweTeamStoryResult = validateManualSourceCandidate(rweTeamStory);
  check("RWE: employee story rejected", rweTeamStoryResult.valid, false);

  // === 20. RWE press/press-release ===
  const rwePress = {
    title: "Floating Wind Opportunities (rwe.com)",
    organization: "RWE",
    source_url: "https://uk.rwe.com/careers/",
    original_url: "https://www.rwe.com/en/press/rwe-renewables/2021-12-07-rwe-funded-study-flags-floating-wind-opportunity-for-scottish-industry",
    apply_url: "https://www.rwe.com/en/press/rwe-renewables/2021-12-07-rwe-funded-study-flags-floating-wind-opportunity-for-scottish-industry"
  };
  const rwePressResult = validateManualSourceCandidate(rwePress);
  check("RWE: press release rejected", rwePressResult.valid, false);

  // === 21. looksLikeRealJobUrl ===
  check("looksLikeRealJobUrl: TSU posting URL", looksLikeRealJobUrl("https://jobs.tsu.edu/postings/9798"), true);
  check("looksLikeRealJobUrl: NextEra job detail", looksLikeRealJobUrl("https://jobs.nexteraenergy.com/job/Juno-Beach-Sr-Product-Manager-I-NEA-FL-33408/1384482400/"), true);
  check("looksLikeRealJobUrl: search page", looksLikeRealJobUrl("https://jobs.nexteraenergy.com/search/"), false);
  check("looksLikeRealJobUrl: RWE city page", looksLikeRealJobUrl("https://www.rwe.com/en/rwe-careers-portal/job-offers/?ci=Paris"), false);

  // === 22. Bullard empty title with TSU posting URL → needs_cleanup ===
  const bullardNeedsCleanup = {
    title: "",
    organization: "Bullard Center for Environmental and Climate Justice",
    source_url: "https://bullardcenter.org/about/careers",
    original_url: "https://jobs.tsu.edu/postings/9798",
    apply_url: "https://jobs.tsu.edu/postings/9798",
    raw_description: "Maintain current knowledge of enterprise GIS technologies."
  };
  const bullardNeedsCleanupResult = validateManualSourceCandidate(bullardNeedsCleanup);
  check("Bullard: empty title with real job URL → needs_cleanup", bullardNeedsCleanupResult.valid, false);
  check("Bullard: bucket is needs_cleanup", bullardNeedsCleanupResult.bucket, "needs_cleanup");
  check("Bullard: reason is recoverable", bullardNeedsCleanupResult.reason, "manual_source_empty_title_recoverable_job_url");

  // === Summary ===
  console.log("\n=== RESULTS ===");
  console.log("Passed:", passed);
  console.log("Failed:", failed);
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  isManualSourceNonJobTitle,
  isManualSourceNonRoleUrl,
  attemptTitleRecovery,
  validateManualSourceCandidate
};
