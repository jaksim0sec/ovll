(function(global){
"use strict";

const FORMAT_ALIASES=[
  ["PDF",/(?:\.pdf\b|\bpdf\b)/i],
  ["DOCX",/(?:\.docx\b|\bdocx\b|\bword\b|워드)/i],
  ["XLSX",/(?:\.xlsx\b|\bxlsx\b|\bexcel\b|엑셀)/i],
  ["CSV",/(?:\.csv\b|\bcsv\b)/i],
  ["JSON",/(?:\.json\b|\bjson\b)/i],
  ["HTML",/(?:\.html?\b|\bhtml\b)/i],
  ["RTF",/(?:\.rtf\b|\brtf\b)/i],
  ["MD",/(?:\.md\b|\bmarkdown\b|마크다운)/i],
  ["TXT",/(?:\.txt\b|\btxt\b|텍스트 파일)/i]
];

function clampPages(value){
  const number=
    Number(value);

  if(
    !Number.isInteger(number)||
    number<1||
    number>30
  ){
    return null;
  }

  return number;
}

function pageTargetFromRequest(
  request
){
  const text=
    String(request||"")
      .replace(/\s+/g," ")
      .trim();

  if(!text){
    return null;
  }

  const directPatterns=[
    /(?:^|[\s,(])([1-9]\d?)\s*(?:페이지|쪽)(?=$|[\s,.)]|분량|정도|짜리|내외|가량|로|으로)/i,
    /(?:^|[\s,(])A4\s*([1-9]\d?)\s*장(?:\s*(?:분량|정도|짜리|내외|가량|로|으로))?/i,
    /(?:^|[\s,(])([1-9]\d?)\s*장\s*(?:분량|정도|짜리|내외|가량|으로|로)(?=$|[\s,.)])/i
  ];

  for(
    const pattern
    of directPatterns
  ){
    const match=
      text.match(pattern);

    if(!match){
      continue;
    }

    const number=
      clampPages(
        match[1]
      );

    if(number){
      return number;
    }
  }

  return null;
}

function resolve(
  params
){
  const source=
    params&&
    typeof params==="object"
      ?params
      :{};

  const request=
    String(
      source.request||
      ""
    )
      .replace(/\s+/g," ")
      .trim()
      .slice(0,1200);

  let format=
    String(
      source.format||
      ""
    )
      .trim()
      .toUpperCase();

  if(request){
    const matched=
      FORMAT_ALIASES.find(
        ([,pattern])=>
          pattern.test(request)
      );

    if(matched){
      format=
        matched[0];
    }
  }

  if(
    !FORMAT_ALIASES.some(
      ([value])=>
        value===format
    )
  ){
    format="PDF";
  }

  let filename=
    String(
      source.filename||
      ""
    ).trim();

  const extensionMatch=
    request.match(
      /([^\n"'“”\\/]{1,80})\.(pdf|docx|xlsx|csv|txt|md|json|html?|rtf)\b/i
    );

  if(extensionMatch){
    filename=
      extensionMatch[1]
        .replace(
          /^(?:파일명|이름)\s*(?:은|는|:)?\s*/i,
          ""
        )
        .trim();

    const ext=
      extensionMatch[2]
        .toUpperCase();

    format=
      ext==="HTM"
        ?"HTML"
        :ext;
  }else if(
    !filename&&
    request
  ){
    const named=
      request.match(
        /(?:파일명|이름)\s*(?:은|는|:)?\s*["'“]?([^"'”\n,]{1,64})/i
      );

    if(named){
      filename=
        named[1]
          .replace(
            /\s*(?:파일)?(?:로|으로)?\s*(?:만들어|생성).*$/i,
            ""
          )
          .trim();
    }
  }

  filename=
    (filename||"결과물")
      .replace(
        /\.(pdf|docx|xlsx|csv|txt|md|json|html?|rtf)$/i,
        ""
      )
      .replace(
        /[\\/:*?"<>|\u0000-\u001f]/g,
        "_"
      )
      .trim()
      .slice(0,100)||
    "결과물";

  return{
    format,
    filename,
    targetPages:
      pageTargetFromRequest(
        request
      ),
    request
  };
}

global.OvllArtifactRequest=
  Object.freeze({
    resolve,
    targetPagesFromRequest:
      pageTargetFromRequest
  });

})(window);
