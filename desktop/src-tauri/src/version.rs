//! semver 비교 (ListUp app/src/lib/pure/versions.ts 와 같은 규칙).
//! 숫자 부분을 차례로 견주고, 같으면 꼬리표(-beta 등)가 없는 쪽이 높다.

use std::cmp::Ordering;

fn split(v: &str) -> (Vec<u64>, Option<&str>) {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let nums = core.split('.').map(|n| n.parse().unwrap_or(0)).collect();
    (nums, pre)
}

pub fn compare(a: &str, b: &str) -> Ordering {
    let (an, ap) = split(a);
    let (bn, bp) = split(b);
    for i in 0..an.len().max(bn.len()) {
        let x = an.get(i).copied().unwrap_or(0);
        let y = bn.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    match (ap, bp) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            // beta.2 < beta.10 이 되게 점 단위로 숫자면 숫자로 견준다
            for (p, q) in x.split('.').zip(y.split('.')) {
                let o = match (p.parse::<u64>(), q.parse::<u64>()) {
                    (Ok(m), Ok(n)) => m.cmp(&n),
                    _ => p.cmp(q),
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
            x.split('.').count().cmp(&y.split('.').count())
        }
    }
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    compare(latest, current) == Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers() {
        assert!(is_newer("1.1.0", "1.0.0"));
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(is_newer("2.0", "1.99.99"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("1.0", "1.0.0"));
        assert!(!is_newer("0.9.9", "1.0.0"));
        assert!(is_newer("v1.0.1", "1.0.0"));
    }

    #[test]
    fn prerelease() {
        assert!(is_newer("1.1.0", "1.1.0-beta"));
        assert!(!is_newer("1.1.0-beta", "1.1.0"));
        assert!(is_newer("1.1.0-beta", "1.0.0"));
        assert!(is_newer("1.1.0-beta.10", "1.1.0-beta.2"));
        assert!(is_newer("1.1.0-beta.1", "1.1.0-beta"));
    }
}
