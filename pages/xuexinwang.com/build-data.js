function buildResult1(p) {
  var item = { cc: p.层次, xxxs: p.学习形式, zymc: p.专业, yxmc: p.学校名称 };
  return {
    result: {
      xj: {
        exist: true, amount: 1, xm: "", showZxsTips: false, zjhm: "",
        dataList: [Object.assign({ id: "kupksh8z5z90n98f" }, item)]
      },
      xl: {
        exist: true, amount: 1, xm: "", zjhm: "",
        dataList: [Object.assign({ id: "tt3wd2peoxft4pl8", xlzms: false }, item)]
      },
      ky: { exist: false, amount: 0, dataList: [] },
      xw: { exist: false, amount: 0, xm: p.姓名, dataList: [], zjhm: p.证件号码 }
    },
    message: "", status: 0
  };
}

function buildResult2(p) {
  return {
    result: {
      xm: p.姓名, xb: p.性别, csrq: p.出生日期, mz: p.民族, sfzh: p.证件号码,
      yxmc: p.学校名称, zymc: p.专业, cc: p.层次, xxxs: p.学习形式,
      xz: p.学制, xllb: p.学历类别, fy: p.分院, xsh: p.系所,
      bh: p.班级, xh: p.学号, rxrq: p.入学日期, byrq: p.毕业日期,
      xjzt: p.学籍状态, mzItemName: "民族", byrqItemName: "离校日期",
      id: "kupksh8z5z90n98f", xlzms: false,
      hasLqPic: !!p.录取照片, hasXlPic: !!p.学历照片,
      zpCollateVo: null, showZpCollated: false, showTxcjm: false, showZppj: false
    },
    message: "", status: 0
  };
}

function buildXueliResult(p) {
  return {
    result: {
      xl: {
        xm: p.姓名, xb: p.性别, csrq: p.出生日期, cc: p.层次,
        yxmc: p.学校名称, zymc: p.专业, xxxs: p.学习形式,
        xz: p.学制, xllb: p.学历类别, rxrq: p.入学日期, byrq: p.毕业日期,
        bjyjl: p.毕结业, zsbh: p.证书编号, xzm: p.校长姓名,
        hasXlPic: !!p.学历照片, xlzms: false,
        fzrq: "", fzzsbh: "", fzyxmc: "", id: "tt3wd2peoxft4pl8"
      },
      xlfyzyList: [], hasXlfzzy: false, type: "ypcwk"
    },
    message: "", status: 0
  };
}

function ensureProfile() {
  if (!localStorage.getItem("xuexin_user")) {
    var acc = XUEXIN_CONFIG.accounts;
    var key = Object.keys(acc)[0];
    localStorage.setItem("xuexin_user", JSON.stringify(acc[key]));
  }
}

function getProfile() {
  ensureProfile();
  var profile = JSON.parse(localStorage.getItem("xuexin_user"));
  var custom = localStorage.getItem("xuexin_user_custom");
  if (custom) { Object.assign(profile, JSON.parse(custom)); }
  return profile;
}
